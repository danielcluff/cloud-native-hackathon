/**
 * Foreground capture loop: at most ONE capture in flight, targeting one frame
 * per `intervalMs`. Pure TypeScript (no React Native imports) so it can be
 * unit-tested with `node --test`.
 *
 * Capturing a frame is NOT analysis. Frames go to a pluggable FrameConsumer;
 * in milestone 1 the only consumer is a no-op/diagnostic one.
 */
import type { FrameMeta } from '../../../shared/contracts';

export interface CapturedFrame {
  /** Transient file:// URI in the app cache. Deleted after consumption. */
  uri: string;
  meta: FrameMeta;
}

/** Future seam: e.g. upload to backend /v1/vision/assess. */
export interface FrameConsumer {
  consume(frame: CapturedFrame, signal: AbortSignal): Promise<void>;
}

export interface CaptureStats {
  running: boolean;
  inFlight: boolean;
  captures: number;
  /** Frames dropped because the consumer was still busy with an older one. */
  dropped: number;
  errors: number;
  lastError: string | null;
  lastCapturedAt: number | null;
  lastCaptureDurationMs: number | null;
}

export type CaptureFn = () => Promise<{ uri: string; width: number; height: number }>;

export interface CaptureLoopDeps {
  /** Take one picture. Must reject if the camera is unavailable. Can be bound later via setCapture(). */
  capture?: CaptureFn;
  /** Delete the transient file. Must never throw. */
  discard: (uri: string) => void;
  consumer?: FrameConsumer;
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onStats?: (stats: CaptureStats) => void;
}

export class CaptureLoop {
  private deps: Required<Omit<CaptureLoopDeps, 'onStats' | 'capture'>>;
  private capture: CaptureFn = () => Promise.reject(new Error('Camera is not ready'));
  private listeners = new Set<(stats: CaptureStats) => void>();
  private timer: unknown = null;
  /** Incremented on every start/stop; stale async work checks it and bails. */
  private generation = 0;
  private seq = 0;
  private inFlight: Promise<void> | null = null;
  private consumerBusy = false;
  private consumerAbort: AbortController | null = null;
  private stats: CaptureStats = {
    running: false,
    inFlight: false,
    captures: 0,
    dropped: 0,
    errors: 0,
    lastError: null,
    lastCapturedAt: null,
    lastCaptureDurationMs: null,
  };

  constructor({ capture, onStats, ...deps }: CaptureLoopDeps) {
    this.deps = {
      consumer: noopFrameConsumer,
      intervalMs: 1000,
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    };
    if (capture) this.capture = capture;
    if (onStats) this.listeners.add(onStats);
  }

  /** Swap the consumer (e.g. when the backend URL or callbacks change). */
  setConsumer(consumer: FrameConsumer): void {
    this.deps.consumer = consumer;
  }

  setCapture(capture: CaptureFn): void {
    this.capture = capture;
  }

  subscribe(listener: (stats: CaptureStats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStats(): CaptureStats {
    return { ...this.stats };
  }

  get running(): boolean {
    return this.stats.running;
  }

  start(): void {
    if (this.stats.running) return;
    this.generation++;
    this.consumerAbort = new AbortController();
    this.update({ running: true });
    this.schedule(0, this.generation);
  }

  /** Stops the loop, aborts consumers, waits for any in-flight capture. */
  async stop(): Promise<void> {
    this.generation++;
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.consumerAbort?.abort();
    this.consumerAbort = null;
    this.update({ running: false });
    if (this.inFlight) await this.inFlight;
  }

  /** Single manual capture. Returns false if a capture is already in flight. */
  async captureOnce(): Promise<boolean> {
    if (this.inFlight) return false;
    const gen = this.generation;
    if (!this.consumerAbort) this.consumerAbort = new AbortController();
    await this.runCapture(gen);
    return true;
  }

  private schedule(delayMs: number, gen: number): void {
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.tick(gen);
    }, delayMs);
  }

  private async tick(gen: number): Promise<void> {
    if (gen !== this.generation || !this.stats.running) return;
    const startedAt = this.deps.now();
    if (!this.inFlight) await this.runCapture(gen);
    if (gen !== this.generation || !this.stats.running) return;
    const elapsed = this.deps.now() - startedAt;
    this.schedule(Math.max(0, this.deps.intervalMs - elapsed), gen);
  }

  private runCapture(gen: number): Promise<void> {
    const p = this.doCapture(gen).finally(() => {
      this.inFlight = null;
      this.update({ inFlight: false });
    });
    this.inFlight = p;
    this.update({ inFlight: true });
    return p;
  }

  private async doCapture(gen: number): Promise<void> {
    const t0 = this.deps.now();
    let shot: { uri: string; width: number; height: number };
    try {
      shot = await this.capture();
    } catch (e) {
      this.update({ errors: this.stats.errors + 1, lastError: e instanceof Error ? e.message : String(e) });
      return;
    }
    const t1 = this.deps.now();
    // Stopped (or restarted) while capturing: throw the frame away.
    if (gen !== this.generation) {
      this.deps.discard(shot.uri);
      return;
    }
    const frame: CapturedFrame = {
      uri: shot.uri,
      meta: { seq: ++this.seq, capturedAt: t1, width: shot.width, height: shot.height },
    };
    this.update({
      captures: this.stats.captures + 1,
      lastCapturedAt: t1,
      lastCaptureDurationMs: t1 - t0,
      lastError: null,
    });

    // Latest-wins: never queue frames behind a slow consumer.
    if (this.consumerBusy || !this.consumerAbort) {
      this.update({ dropped: this.stats.dropped + 1 });
      this.deps.discard(frame.uri);
      return;
    }
    this.consumerBusy = true;
    const signal = this.consumerAbort.signal;
    // Consumer runs detached so a slow network call does not block capture.
    void this.deps.consumer
      .consume(frame, signal)
      .catch((e: unknown) => {
        if (!signal.aborted) {
          this.update({ errors: this.stats.errors + 1, lastError: e instanceof Error ? e.message : String(e) });
        }
      })
      .finally(() => {
        this.consumerBusy = false;
        this.deps.discard(frame.uri);
      });
  }

  private update(patch: Partial<CaptureStats>): void {
    this.stats = { ...this.stats, ...patch };
    const snapshot = this.getStats();
    for (const l of this.listeners) l(snapshot);
  }
}

/** Milestone-1 consumer: does nothing with pixels. Explicitly NOT analysis. */
export const noopFrameConsumer: FrameConsumer = {
  consume: async () => {},
};

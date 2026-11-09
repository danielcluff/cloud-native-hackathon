/**
 * Single owner of the audio path, so we never record while speaking/playing
 * (feedback, and the mic would capture our own TTS). Pure TypeScript.
 *
 * Rules:
 *  - 'recording' preempts everyone (stops speech and playback first).
 *  - 'speech' and 'playback' preempt each other, but are REFUSED while recording.
 */
export type AudioOwner = 'speech' | 'recording' | 'playback';

type StopFn = () => unknown;

export class AudioCoordinator {
  private owner: AudioOwner | null = null;
  private stops = new Map<AudioOwner, StopFn>();
  private listeners = new Set<(owner: AudioOwner | null) => void>();

  register(owner: AudioOwner, stop: StopFn): () => void {
    this.stops.set(owner, stop);
    return () => {
      if (this.stops.get(owner) === stop) this.stops.delete(owner);
    };
  }

  current(): AudioOwner | null {
    return this.owner;
  }

  /** Returns false if the claim is refused. Stops the previous owner otherwise. */
  async claim(next: AudioOwner): Promise<boolean> {
    if (this.owner === next) return true;
    if (this.owner === 'recording' && next !== 'recording') return false;
    const prev = this.owner;
    if (prev) {
      try {
        await this.stops.get(prev)?.();
      } catch {
        // Stopping must not block the new owner; the error is non-actionable here.
      }
    }
    this.set(next);
    return true;
  }

  release(owner: AudioOwner): void {
    if (this.owner === owner) this.set(null);
  }

  subscribe(fn: (owner: AudioOwner | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(owner: AudioOwner | null) {
    this.owner = owner;
    for (const l of this.listeners) l(owner);
  }
}

export const audioCoordinator = new AudioCoordinator();

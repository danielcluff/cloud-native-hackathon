import type { CameraView } from 'expo-camera';
import { File } from 'expo-file-system';
import { useEffect, useState, type RefObject } from 'react';
import { CaptureLoop, noopFrameConsumer, type CaptureStats, type FrameConsumer } from './captureLoop';

/** Delete a transient capture. Never throws; never logs the path's contents. */
export function discardCapture(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Best effort: the OS also purges the cache directory.
  }
}

/**
 * Binds a CaptureLoop to a CameraView ref. The caller decides WHEN capture may
 * run (`enabled` = screen focused AND app active AND camera ready); this hook
 * stops the loop whenever that becomes false, and on unmount.
 */
export function useCaptureLoop(
  cameraRef: RefObject<CameraView | null>,
  enabled: boolean,
  consumer: FrameConsumer = noopFrameConsumer,
) {
  // One loop per mounted component. Built without touching refs; the camera
  // is bound in an effect below.
  const [loop] = useState(() => new CaptureLoop({ intervalMs: 1000, discard: discardCapture }));
  const [stats, setStats] = useState<CaptureStats>(() => loop.getStats());

  useEffect(() => {
    loop.setCapture(async () => {
      const cam = cameraRef.current;
      if (!cam) throw new Error('Camera is not ready');
      // Low quality is plenty for obstacle checks and keeps uploads small.
      // shutterSound off: a click every second would mask spoken feedback.
      const pic = await cam.takePictureAsync({ quality: 0.4, shutterSound: false, exif: false });
      return { uri: pic.uri, width: pic.width, height: pic.height };
    });
    return loop.subscribe(setStats);
  }, [loop, cameraRef]);

  useEffect(() => {
    loop.setConsumer(consumer);
  }, [loop, consumer]);

  useEffect(() => {
    if (!enabled) void loop.stop();
  }, [enabled, loop]);

  useEffect(() => () => void loop.stop(), [loop]);

  return {
    stats,
    start: () => {
      if (enabled) loop.start();
    },
    stop: () => loop.stop(),
    captureOnce: () => (enabled ? loop.captureOnce() : Promise.resolve(false)),
  };
}

import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { discardCapture } from '../capture/useCaptureLoop';
import { audioCoordinator } from './audioCoordinator';

export type MicPermission = 'unknown' | 'granted' | 'denied' | 'blocked';
const DEFAULT_MAX_RECORDING_MS = 10_000;

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Record a short clip and play it back, coordinated with TTS so the mic never
 * records our own speech. The clip is a transient cache file deleted on the
 * next recording and on unmount; it is never uploaded or logged.
 */
export function useMicCheck(
  options: { maxRecordingMs?: number; onAutoStop?: (uri: string | null) => void } = {},
) {
  const maxRecordingMs = options.maxRecordingMs ?? DEFAULT_MAX_RECORDING_MS;
  const onAutoStopRef = useRef(options.onAutoStop);
  useEffect(() => {
    onAutoStopRef.current = options.onAutoStop;
  }, [options.onAutoStop]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clipRef = useRef<string | null>(null);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingRef = useRef(false);

  const refreshPermission = useCallback(async () => {
    const p = await getRecordingPermissionsAsync();
    setPermission(p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'blocked');
    return p;
  }, []);

  useEffect(() => {
    let live = true;
    getRecordingPermissionsAsync()
      .then((p) => {
        if (live) setPermission(p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'blocked');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /** Stops recording and resolves to the clip URI (null if nothing was recorded). */
  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (autoStop.current) clearTimeout(autoStop.current);
    autoStop.current = null;
    if (!recordingRef.current) return null;
    recordingRef.current = false;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (clipRef.current && clipRef.current !== uri) discardCapture(clipRef.current);
      clipRef.current = uri;
      setClipUri(uri);
      return uri;
    } catch (e) {
      setError(`Could not stop recording: ${errMsg(e)}`);
      return null;
    } finally {
      // Leave record mode so playback uses the loudspeaker, not the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      audioCoordinator.release('recording');
    }
  }, [recorder]);

  /** Delete the current clip (e.g. right after it was uploaded). */
  const discardClip = useCallback(() => {
    if (clipRef.current) discardCapture(clipRef.current);
    clipRef.current = null;
    setClipUri(null);
  }, []);

  const stopPlayback = useCallback(() => {
    try {
      player.pause();
    } catch {
      // player may already be released during unmount
    }
    audioCoordinator.release('playback');
  }, [player]);

  useEffect(() => {
    const unRec = audioCoordinator.register('recording', stopRecording);
    const unPlay = audioCoordinator.register('playback', stopPlayback);
    return () => {
      unRec();
      unPlay();
    };
  }, [stopRecording, stopPlayback]);

  const startRecording = useCallback(async () => {
    setError(null);
    let p = await refreshPermission();
    if (!p.granted && p.canAskAgain) p = await requestRecordingPermissionsAsync();
    if (!p.granted) {
      setPermission(p.canAskAgain ? 'denied' : 'blocked');
      return;
    }
    setPermission('granted');
    // Preempts TTS and playback, so the mic never hears the app talking.
    await audioCoordinator.claim('recording');
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      autoStop.current = setTimeout(() => {
        void stopRecording().then((uri) => onAutoStopRef.current?.(uri));
      }, maxRecordingMs);
    } catch (e) {
      recordingRef.current = false;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      audioCoordinator.release('recording');
      setError(`Could not start recording: ${errMsg(e)}`);
    }
  }, [recorder, refreshPermission, stopRecording, maxRecordingMs]);

  const play = useCallback(async () => {
    if (!clipRef.current) return;
    setError(null);
    if (!(await audioCoordinator.claim('playback'))) {
      setError('Stop recording before playing back.');
      return;
    }
    try {
      player.replace({ uri: clipRef.current });
      await player.seekTo(0);
      player.play();
    } catch (e) {
      audioCoordinator.release('playback');
      setError(`Playback failed: ${errMsg(e)}`);
    }
  }, [player]);

  useEffect(() => {
    if (playerStatus.didJustFinish) audioCoordinator.release('playback');
  }, [playerStatus.didJustFinish]);

  // No background audio in this app: stop recording/playback when backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        void stopRecording();
        stopPlayback();
      }
    });
    return () => sub.remove();
  }, [stopRecording, stopPlayback]);

  // Unmount: stop everything and delete the clip.
  useEffect(
    () => () => {
      void stopRecording().finally(() => {
        if (clipRef.current) discardCapture(clipRef.current);
        clipRef.current = null;
      });
      audioCoordinator.release('playback');
    },
    [stopRecording],
  );

  return {
    permission,
    isRecording: recState.isRecording,
    durationMs: recState.durationMillis,
    isPlaying: playerStatus.playing,
    hasClip: clipUri !== null,
    error,
    startRecording,
    stopRecording,
    discardClip,
    play,
    stopPlayback,
  };
}

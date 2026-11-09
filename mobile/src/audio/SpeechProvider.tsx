import * as Speech from 'expo-speech';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { audioCoordinator } from './audioCoordinator';

interface SpeechApi {
  /** Speak with device TTS (stops anything else speaking first). */
  speak: (text: string) => Promise<void>;
  /**
   * Status message: routed to VoiceOver when it is running (so it does not
   * talk over the screen reader), otherwise spoken with TTS. Always repeatable.
   */
  announce: (text: string) => void;
  stop: () => void;
  repeat: () => void;
  speaking: boolean;
  lastMessage: string | null;
  /** Set when TTS was refused or failed, so UI can tell the user why. */
  speechError: string | null;
}

const SpeechContext = createContext<SpeechApi | null>(null);

export function SpeechProvider({ children }: { children: ReactNode }) {
  const [speaking, setSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const screenReader = useRef(false);
  const utteranceId = useRef(0);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then((v) => (screenReader.current = v));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v) => (screenReader.current = v));
    const unregister = audioCoordinator.register('speech', () => {
      Speech.stop();
      setSpeaking(false);
    });
    return () => {
      sub.remove();
      unregister();
      Speech.stop();
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    setLastMessage(text);
    if (!(await audioCoordinator.claim('speech'))) {
      setSpeechError('Speech is paused while the microphone is recording.');
      return;
    }
    setSpeechError(null);
    const id = ++utteranceId.current;
    Speech.stop(); // drop any queued utterance; we want "latest wins"
    // Callbacks from an older, interrupted utterance must not release the
    // audio path that this newer utterance now owns.
    const done = () => {
      if (id !== utteranceId.current) return;
      setSpeaking(false);
      audioCoordinator.release('speech');
    };
    Speech.speak(text, {
      rate: 1.0,
      onStart: () => setSpeaking(true),
      onDone: done,
      onStopped: done,
      onError: (e) => {
        done();
        setSpeechError(`Speech failed: ${e.message}`);
      },
    });
  }, []);

  const stop = useCallback(() => {
    utteranceId.current++;
    Speech.stop();
    setSpeaking(false);
    audioCoordinator.release('speech');
  }, []);

  const announce = useCallback(
    (text: string) => {
      setLastMessage(text);
      if (screenReader.current) AccessibilityInfo.announceForAccessibility(text);
      else void speak(text);
    },
    [speak],
  );

  const repeat = useCallback(() => {
    if (lastMessage) void speak(lastMessage);
  }, [lastMessage, speak]);

  const api = useMemo(
    () => ({ speak, announce, stop, repeat, speaking, lastMessage, speechError }),
    [speak, announce, stop, repeat, speaking, lastMessage, speechError],
  );
  return <SpeechContext.Provider value={api}>{children}</SpeechContext.Provider>;
}

export function useSpeech(): SpeechApi {
  const ctx = useContext(SpeechContext);
  if (!ctx) throw new Error('useSpeech must be used inside <SpeechProvider>');
  return ctx;
}

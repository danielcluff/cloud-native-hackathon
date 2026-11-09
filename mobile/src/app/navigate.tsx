import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { useSpeech } from '../audio/SpeechProvider';
import type { VisionAssessment } from '../../../shared/contracts';
import { assessFrame } from '../api';
import { noopFrameConsumer, type FrameConsumer } from '../capture/captureLoop';
import { DirectionFeed } from '../capture/DirectionFeedView';
import { makeEntry, pushEntry, type FeedEntry } from '../capture/directionFeed';
import { FeedbackPolicy, VISION_STALE_AFTER_MS } from '../capture/feedbackPolicy';
import { useCaptureLoop } from '../capture/useCaptureLoop';
import { BACKEND_URL } from '../config';
import { BigButton, Body, DemoBanner, Heading, Screen, Status, colors } from '../ui/components';

function useNow(intervalMs: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export default function NavigateScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { announce } = useSpeech();
  const [feedbackOn, setFeedbackOn] = useState(BACKEND_URL !== null);
  const [policy] = useState(() => new FeedbackPolicy());
  const [last, setLast] = useState<{ result: VisionAssessment; capturedAt: number } | null>(null);
  // Debug text feed of every assessment and whether it was announced.
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const feedId = useRef(0);
  const cameraRef = useRef<CameraView>(null);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [cameraReady, setCameraReady] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        setCameraReady(false); // CameraView unmounts; must re-signal ready
      };
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (s !== 'active') setCameraReady(false);
    });
    return () => sub.remove();
  }, []);

  const granted = permission?.granted === true;
  // Preview (and therefore capture) only exists while visible + foregrounded.
  const cameraMounted = granted && focused && appActive;
  const enabled = cameraMounted && cameraReady;
  // Each frame is uploaded for assessment; the loop drops new frames while one
  // is in flight, so latency (not the 1 s timer) sets the effective rate.
  const consumer = useMemo<FrameConsumer>(
    () =>
      feedbackOn
        ? {
            consume: async (frame, signal) => {
              const result = await assessFrame(frame, signal);
              if (signal.aborted) return;
              setLast({ result, capturedAt: frame.meta.capturedAt });
              const decidedAt = Date.now();
              const phrase = policy.decide(result, frame.meta.capturedAt, decidedAt);
              if (phrase) announce(phrase);
              const id = ++feedId.current;
              setFeed((f) => pushEntry(f, makeEntry(id, result, phrase, frame.meta, decidedAt)));
            },
          }
        : noopFrameConsumer,
    [feedbackOn, policy, announce],
  );
  const { stats, start, stop, captureOnce } = useCaptureLoop(cameraRef, enabled, consumer);
  const now = useNow(500, stats.running || stats.captures > 0);

  // Tell the user if the loop was stopped by leaving/backgrounding.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !stats.running && !enabled) announce('Camera capture stopped.');
    wasRunning.current = stats.running;
  }, [stats.running, enabled, announce]);

  const ageS = stats.lastCapturedAt ? ((now - stats.lastCapturedAt) / 1000).toFixed(1) : null;
  const resultStale = last ? now - last.capturedAt > VISION_STALE_AFTER_MS : false;
  const resultText = !feedbackOn
    ? 'Obstacle feedback is off. Frames are captured but not analyzed.'
    : !last
      ? 'No assessment yet.'
      : resultStale
        ? 'Last assessment is out of date.'
        : last.result.state === 'ok'
          ? last.result.spokenSummary
          : last.result.state === 'unknown'
            ? last.result.reason
            : last.result.state === 'unavailable'
              ? `Feedback unavailable: ${last.result.reason}`
              : last.result.state === 'error'
                ? `Feedback error: ${last.result.message}`
                : 'Waiting…';

  return (
    <Screen>
      <Heading>Navigate</Heading>
      <DemoBanner title="Obstacle hints only — not a safety device">
        The camera announces fixed obstacles and people standing in your way. It looks for the nearest visible opening
        around an obstacle and calls out a lone person who stays in view and is close ahead. It can miss things and can
        never confirm a path is safe. Keep using your cane, guide dog, or a sighted guide, and confirm landmarks for
        direction.
      </DemoBanner>

      {!permission ? (
        <Status>Checking camera permission…</Status>
      ) : !granted ? (
        <View style={s.gap}>
          <Status tone="error">Camera access is off.</Status>
          {permission.canAskAgain ? (
            <BigButton label="Allow camera" hint="Shows the system camera permission prompt" onPress={requestPermission} />
          ) : (
            <BigButton
              label="Open Settings"
              hint="Camera was denied. Opens iPhone Settings so you can allow it."
              onPress={() => void Linking.openSettings()}
            />
          )}
        </View>
      ) : (
        <>
          <View
            style={s.preview}
            accessible
            accessibilityLabel={cameraMounted ? 'Rear camera preview' : 'Camera paused'}
          >
            {cameraMounted ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                animateShutter={false}
                onCameraReady={() => {
                  setMountError(null);
                  setCameraReady(true);
                }}
                onMountError={(e) => setMountError(e.message)}
              />
            ) : null}
          </View>
          {mountError ? <Status tone="error">Camera error: {mountError}</Status> : null}
          {feedbackOn ? <DirectionFeed entries={feed} onClear={() => setFeed([])} /> : null}
          <Status>
            {stats.running
              ? 'Capturing about one frame per second.'
              : cameraReady
                ? 'Camera ready. Capture is stopped.'
                : 'Starting camera…'}
          </Status>

          {stats.running ? (
            <BigButton
              label="Stop capture"
              tone="danger"
              onPress={() => {
                void stop().then(() => announce('Capture stopped.'));
              }}
            />
          ) : (
            <BigButton
              label="Start capture"
              hint="Takes about one photo per second while this screen is open. Photos are deleted right away."
              disabled={!enabled}
              onPress={() => {
                policy.reset();
                setFeed([]);
                start();
                announce('Capture started.');
              }}
            />
          )}
          <BigButton
            label={feedbackOn ? 'Turn obstacle feedback off' : 'Turn obstacle feedback on'}
            tone="secondary"
            hint={
              BACKEND_URL
                ? 'Feedback uploads each frame to the backend for an AI obstacle check, then deletes it.'
                : 'Backend URL is not configured, so feedback cannot run.'
            }
            disabled={!BACKEND_URL}
            selected={feedbackOn}
            onPress={() => {
              const next = !feedbackOn;
              setFeedbackOn(next);
              policy.reset();
              setLast(null);
              setFeed([]);
              announce(next ? 'Obstacle feedback on.' : 'Obstacle feedback off.');
            }}
          />
          <BigButton
            label="Take one photo"
            tone="secondary"
            disabled={!enabled || stats.inFlight}
            onPress={() => {
              void captureOnce().then((ok) =>
                announce(
                  !ok
                    ? 'Camera busy.'
                    : feedbackOn
                      ? 'Photo captured. Checking for obstacles.'
                      : 'Photo captured. It was not analyzed.',
                ),
              );
            }}
          />

          <View accessible accessibilityLabel={`Diagnostics. ${stats.captures} frames captured. ${
            ageS ? `Last frame ${ageS} seconds ago.` : 'No frames yet.'
          } ${stats.dropped} dropped. ${stats.errors} errors. Last assessment: ${resultText}`}>
            <Body>Frames captured: {stats.captures}</Body>
            <Body>Last frame age: {ageS ? `${ageS} s` : '—'}</Body>
            <Body>Last capture took: {stats.lastCaptureDurationMs != null ? `${stats.lastCaptureDurationMs} ms` : '—'}</Body>
            <Body>Dropped (consumer busy): {stats.dropped}</Body>
            <Body>Errors: {stats.errors}{stats.lastError ? ` (${stats.lastError})` : ''}</Body>
            <Body>Last assessment: {resultText}</Body>
            {last?.result.state === 'ok' && !resultStale ? (
              <Body>
                People in path: {last.result.people}. Closest visible opening: {last.result.openSide}.
              </Body>
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  gap: { gap: 12 },
  preview: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
});

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { useSpeech } from '../audio/SpeechProvider';
import { useCaptureLoop } from '../capture/useCaptureLoop';
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
  const { stats, start, stop, captureOnce } = useCaptureLoop(cameraRef, enabled);
  const now = useNow(500, stats.running || stats.captures > 0);

  // Tell the user if the loop was stopped by leaving/backgrounding.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !stats.running && !enabled) announce('Camera capture stopped.');
    wasRunning.current = stats.running;
  }, [stats.running, enabled, announce]);

  const ageS = stats.lastCapturedAt ? ((now - stats.lastCapturedAt) / 1000).toFixed(1) : null;

  return (
    <Screen>
      <Heading>Navigate</Heading>
      <DemoBanner>
        Camera frames are captured but NOT analyzed yet. Nothing here tells you whether a path is clear. Use your
        cane, guide dog, or a sighted guide as usual.
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
                start();
                announce('Capture started.');
              }}
            />
          )}
          <BigButton
            label="Take one photo"
            tone="secondary"
            disabled={!enabled || stats.inFlight}
            onPress={() => {
              void captureOnce().then((ok) => announce(ok ? 'Photo captured. It was not analyzed.' : 'Camera busy.'));
            }}
          />

          <View accessible accessibilityLabel={`Diagnostics. ${stats.captures} frames captured. ${
            ageS ? `Last frame ${ageS} seconds ago.` : 'No frames yet.'
          } ${stats.dropped} dropped. ${stats.errors} errors.`}>
            <Body>Frames captured: {stats.captures}</Body>
            <Body>Last frame age: {ageS ? `${ageS} s` : '—'}</Body>
            <Body>Last capture took: {stats.lastCaptureDurationMs != null ? `${stats.lastCaptureDurationMs} ms` : '—'}</Body>
            <Body>Dropped (consumer busy): {stats.dropped}</Body>
            <Body>Errors: {stats.errors}{stats.lastError ? ` (${stats.lastError})` : ''}</Body>
            <Body>Analysis: not connected (milestone 2)</Body>
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

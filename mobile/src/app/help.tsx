import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useSpeech } from '../audio/SpeechProvider';
import { useMicCheck } from '../audio/useMicCheck';
import { checkBackendHealth, type HealthCheck } from '../config';
import { BigButton, Body, DemoBanner, Heading, Screen, Status } from '../ui/components';

function MicCheck() {
  const mic = useMicCheck();
  const { announce } = useSpeech();
  const wasRecording = useRef(false);

  useEffect(() => {
    // Announce after recording ends (speech is blocked while recording).
    if (wasRecording.current && !mic.isRecording) announce('Recording stopped. You can play it back.');
    wasRecording.current = mic.isRecording;
  }, [mic.isRecording, announce]);
  useEffect(() => {
    if (mic.error) announce(mic.error);
  }, [mic.error, announce]);

  return (
    <View style={{ gap: 12 }}>
      <Heading>Microphone check</Heading>
      <Body>Records up to 10 seconds, then plays it back. The recording stays on this phone and is deleted when you leave.</Body>
      {mic.permission === 'blocked' ? (
        <>
          <Status tone="error">Microphone access is off for this app.</Status>
          <BigButton label="Open Settings" hint="Opens iPhone Settings to allow the microphone" onPress={() => void Linking.openSettings()} />
        </>
      ) : mic.permission === 'denied' ? (
        <Status tone="error">Microphone permission was denied. Tap Record to ask again.</Status>
      ) : null}
      {mic.error ? <Status tone="error">{mic.error}</Status> : null}
      <Status>
        {mic.isRecording
          ? `Recording… ${Math.floor(mic.durationMs / 1000)} seconds`
          : mic.isPlaying
            ? 'Playing back.'
            : mic.hasClip
              ? 'Recording ready to play.'
              : 'Not recording.'}
      </Status>
      {mic.isRecording ? (
        <BigButton label="Stop recording" tone="danger" onPress={() => void mic.stopRecording()} />
      ) : (
        <BigButton
          label="Record"
          hint="Starts recording from the microphone. Speech output pauses while recording."
          disabled={mic.permission === 'blocked'}
          onPress={() => void mic.startRecording()}
        />
      )}
      {mic.isPlaying ? (
        <BigButton label="Stop playback" tone="danger" onPress={mic.stopPlayback} />
      ) : (
        <BigButton
          label="Play recording"
          tone="secondary"
          disabled={!mic.hasClip || mic.isRecording}
          onPress={() => void mic.play()}
        />
      )}
    </View>
  );
}

export default function HelpScreen() {
  const { speak } = useSpeech();
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [checking, setChecking] = useState(false);

  return (
    <Screen>
      <Heading>Help and device check</Heading>
      <DemoBanner>
        Requesting help from event staff is not built yet. When it is, it will be a clearly marked simulation: no real
        staff will be contacted.
      </DemoBanner>

      <Heading>Speech check</Heading>
      <Body>
        On iPhone, device speech may be silent when the Ring/Silent switch is set to silent. If you hear nothing, check
        that switch and the volume.
      </Body>
      <BigButton
        label="Test speech"
        hint="Speaks a short test sentence"
        onPress={() => void speak('Speech is working. You can stop me with the Stop speech button.')}
      />

      <MicCheck />

      <Heading>Backend check</Heading>
      {health?.state === 'ok' ? (
        <Status tone="ok">
          Backend reachable. AI integration {health.health.integrations.openai === 'configured' ? 'configured' : 'not configured'}.
        </Status>
      ) : health?.state === 'unavailable' ? (
        <Status>Backend not configured: {health.reason}</Status>
      ) : health?.state === 'error' ? (
        <Status tone="error">{health.message}</Status>
      ) : null}
      <BigButton
        label={checking ? 'Checking backend…' : 'Check backend'}
        tone="secondary"
        disabled={checking}
        onPress={async () => {
          setChecking(true);
          setHealth(await checkBackendHealth());
          setChecking(false);
        }}
      />
    </Screen>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';
import { checkPairing } from '../api';
import { clearPairingToken, getPairingToken, setPairingToken } from '../auth';
import { useSpeech } from '../audio/SpeechProvider';
import { useMicCheck } from '../audio/useMicCheck';
import { checkBackendHealth, type HealthCheck } from '../config';
import { BigButton, Body, DemoBanner, Heading, Screen, Status, colors } from '../ui/components';

/** Pair this phone with the public backend using a token kept in the keychain. */
function Pairing() {
  const { announce } = useSpeech();
  const [paired, setPaired] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<{ text: string; tone: 'normal' | 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void getPairingToken().then((t) => live && setPaired(t !== null));
    return () => {
      live = false;
    };
  }, []);

  const verify = async () => {
    setBusy(true);
    const r = await checkPairing();
    setBusy(false);
    const next =
      r.state === 'ok'
        ? { text: 'Paired. The backend accepted this phone.', tone: 'ok' as const }
        : { text: r.reason, tone: 'error' as const };
    setStatus(next);
    announce(next.text);
  };

  return (
    <View style={{ gap: 12 }}>
      <Heading>Pair this phone</Heading>
      <Body>
        The backend only answers phones that have its pairing token. Paste the token once; it is stored in this
        iPhone&rsquo;s keychain and never leaves the device except to the backend.
      </Body>
      {status ? <Status tone={status.tone}>{status.text}</Status> : null}
      <Status>{paired === null ? 'Checking…' : paired ? 'A pairing token is saved.' : 'Not paired yet.'}</Status>
      <TextInput
        accessibilityLabel="Pairing token"
        accessibilityHint="Paste the pairing token, then press Save and check"
        placeholder="Paste pairing token"
        placeholderTextColor={colors.muted}
        value={draft}
        onChangeText={setDraft}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
      <BigButton
        label={busy ? 'Checking…' : 'Save and check'}
        disabled={busy || !draft.trim()}
        onPress={async () => {
          try {
            await setPairingToken(draft.trim());
          } catch {
            setStatus({ text: 'Could not save the token on this phone.', tone: 'error' });
            return;
          }
          setDraft('');
          setPaired(true);
          await verify();
        }}
      />
      {paired ? (
        <>
          <BigButton label="Check pairing" tone="secondary" disabled={busy} onPress={() => void verify()} />
          <BigButton
            label="Forget token"
            tone="danger"
            hint="Removes the pairing token from this phone"
            onPress={async () => {
              await clearPairingToken().catch(() => {});
              setPaired(false);
              setStatus({ text: 'Token removed. This phone is no longer paired.', tone: 'normal' });
              announce('Token removed.');
            }}
          />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  input: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: colors.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 20,
  },
});

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
          {health.health.auth === 'token' ? ' Pairing required.' : ' No pairing required (development).'}
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

      <Pairing />
    </Screen>
  );
}

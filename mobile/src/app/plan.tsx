import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PlannerResult, VoiceTurnResult } from '../../../shared/contracts';
import { newConversationId, resetConversation, voiceTurn } from '../api';
import { useSpeech } from '../audio/SpeechProvider';
import { useMicCheck } from '../audio/useMicCheck';
import { BACKEND_URL } from '../config';
import { describeSession, formatLocal } from '../plan/format';
import { BigButton, Body, DemoBanner, Heading, Screen, Status, colors, styles as ui } from '../ui/components';

type Phase = 'idle' | 'recording' | 'thinking';
type LastInput = { kind: 'audio'; uri: string } | { kind: 'text'; text: string };

/**
 * Push-to-talk planning interview (Expo Go compatible):
 * tap Talk -> record -> tap Done -> upload -> backend transcribes + plans -> reply is spoken.
 */
export default function PlanScreen() {
  const { speak, announce, stop: stopSpeech } = useSpeech();
  const [conversationId, setConversationId] = useState(newConversationId);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<VoiceTurnResult | null>(null);
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [typed, setTyped] = useState('');
  const [lastInput, setLastInput] = useState<LastInput | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (input: LastInput) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLastInput(input);
      setPhase('thinking');
      announce('Thinking.');
      let r: VoiceTurnResult;
      try {
        r = await voiceTurn(
          input.kind === 'audio' ? { conversationId, audioUri: input.uri } : { conversationId, text: input.text },
          ctrl.signal,
        );
      } catch {
        return; // aborted: screen left or a newer request started
      }
      if (ctrl.signal.aborted) return;
      setPhase('idle');
      setResult(r);
      if (r.state === 'ok') {
        setPlan(r.plan);
        void speak(r.replyText);
      } else {
        void speak(r.state === 'unavailable' ? `Planning is unavailable. ${r.reason}` : r.message);
      }
    },
    [announce, conversationId, speak],
  );

  const mic = useMicCheck({
    maxRecordingMs: 30_000,
    onAutoStop: (uri) => {
      if (uri) void send({ kind: 'audio', uri });
    },
  });
  const { discardClip } = mic;

  // Delete the audio once the server has it (success or a non-retryable failure).
  useEffect(() => {
    if (phase !== 'idle' || lastInput?.kind !== 'audio') return;
    if (result?.state === 'ok' || (result?.state === 'error' && !result.retryable)) discardClip();
  }, [phase, result, lastInput, discardClip]);

  // Leaving the screen cancels any in-flight request.
  useFocusEffect(
    useCallback(
      () => () => {
        abortRef.current?.abort();
        setPhase('idle');
      },
      [],
    ),
  );

  const recording = mic.isRecording;
  const busy = phase === 'thinking';
  const canRetry = !busy && !recording && result !== null && result.state === 'error' && result.retryable && !!lastInput;

  const startOver = () => {
    abortRef.current?.abort();
    stopSpeech();
    void resetConversation(conversationId);
    discardClip();
    setConversationId(newConversationId());
    setResult(null);
    setPlan(null);
    setLastInput(null);
    setPhase('idle');
    announce('Started over. Tap Talk and tell me what you are interested in.');
  };

  return (
    <Screen>
      <Heading>Plan my day</Heading>
      <DemoBanner title="Real schedule, AI suggestions">
        Sessions come from the official KubeCon North America 2026 schedule. Suggestions are made by AI and can be
        wrong; check times and rooms before you go. Route steps are general and do not replace venue signs or staff.
      </DemoBanner>

      {!BACKEND_URL ? (
        <Status tone="error">Planning needs the backend, but no backend URL is set.</Status>
      ) : null}

      <Body>Tap Talk, say what you are interested in, then tap Done. For example: “I like observability and eBPF, beginner level, Wednesday.”</Body>

      <Status tone={result?.state === 'error' ? 'error' : 'normal'}>
        {recording
          ? `Listening… ${Math.floor(mic.durationMs / 1000)} seconds. Tap Done when finished.`
          : busy
            ? 'Thinking…'
            : result?.state === 'error'
              ? result.message
              : result?.state === 'unavailable'
                ? `Planning unavailable: ${result.reason}`
                : 'Ready.'}
      </Status>
      {mic.error ? <Status tone="error">{mic.error}</Status> : null}
      {mic.permission === 'blocked' ? (
        <BigButton label="Open Settings" hint="Microphone is off. Opens iPhone Settings." onPress={() => void Linking.openSettings()} />
      ) : null}

      {recording ? (
        <BigButton
          label="Done"
          hint="Stops recording and sends what you said"
          tone="danger"
          onPress={async () => {
            const uri = await mic.stopRecording();
            if (uri) void send({ kind: 'audio', uri });
          }}
        />
      ) : (
        <BigButton
          label="Talk"
          hint="Starts listening. Speech output pauses while listening."
          disabled={busy || !BACKEND_URL || mic.permission === 'blocked'}
          onPress={() => void mic.startRecording()}
        />
      )}
      {canRetry ? (
        <BigButton label="Try again" tone="secondary" onPress={() => lastInput && void send(lastInput)} />
      ) : null}

      <View style={s.typeRow}>
        <TextInput
          accessibilityLabel="Type instead"
          accessibilityHint="Type your answer, then press Send"
          placeholder="Or type here"
          placeholderTextColor={colors.muted}
          value={typed}
          onChangeText={setTyped}
          editable={!busy && !recording}
          returnKeyType="send"
          onSubmitEditing={() => {
            if (typed.trim()) {
              void send({ kind: 'text', text: typed.trim() });
              setTyped('');
            }
          }}
          style={s.input}
        />
        <BigButton
          label="Send"
          tone="secondary"
          disabled={!typed.trim() || busy || recording || !BACKEND_URL}
          onPress={() => {
            void send({ kind: 'text', text: typed.trim() });
            setTyped('');
          }}
        />
      </View>

      {result?.state === 'ok' ? (
        <View accessible accessibilityLabel={`You said: ${result.transcript}. Reply: ${result.replyText}`} style={s.card}>
          <Text style={s.label}>You said</Text>
          <Text style={ui.body}>{result.transcript}</Text>
          <Text style={s.label}>Reply</Text>
          <Text style={[ui.body, { color: colors.text }]}>{result.replyText}</Text>
        </View>
      ) : null}

      {plan?.state === 'ok' && plan.recommendations.length > 0 ? (
        <>
          <Heading>Your plan ({plan.recommendations.length})</Heading>
          {plan.recommendations.map((sess, i) => {
            const route = plan.routes.find((r) => r.toSessionId === sess.id);
            return (
              <View key={sess.id} style={s.card}>
                <View accessible accessibilityLabel={`Session ${i + 1}. ${describeSession(sess)}`}>
                  <Text style={s.label}>
                    {formatLocal(sess.startsAt)} – {formatLocal(sess.endsAt, false)}
                  </Text>
                  <Text style={[ui.body, { color: colors.text, fontWeight: '700' }]}>{sess.title}</Text>
                  <Text style={ui.body}>{sess.room}</Text>
                  {sess.track ? <Text style={ui.body}>{sess.track}</Text> : null}
                </View>
                <BigButton
                  label="Hear details"
                  tone="secondary"
                  onPress={() => void speak(`${describeSession(sess)} ${sess.summary}`)}
                />
                {route ? (
                  <BigButton
                    label="Hear route"
                    tone="secondary"
                    hint="General directions by building and level. Confirm with signs or staff."
                    onPress={() => void speak(route.steps.map((st) => st.instruction).join(' '))}
                  />
                ) : null}
                <BigButton
                  label="Open on official schedule"
                  tone="secondary"
                  onPress={() => void Linking.openURL(sess.sourceUrl)}
                />
              </View>
            );
          })}
        </>
      ) : null}

      {result ? <BigButton label="Start over" tone="secondary" onPress={startOver} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  typeRow: { gap: 8 },
  input: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: colors.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 20,
  },
  card: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: colors.surface },
  label: { color: colors.accent, fontSize: 16, fontWeight: '800' },
});

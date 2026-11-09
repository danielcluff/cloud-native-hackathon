import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type AccessibilityState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSpeech } from '../audio/SpeechProvider';

/** High-contrast palette (white on near-black, yellow focus accents). */
export const colors = {
  bg: '#0B0B0C',
  surface: '#1C1C1F',
  text: '#FFFFFF',
  muted: '#D0D0D6',
  accent: '#FFD60A',
  danger: '#FF6B6B',
  ok: '#4ADE80',
  buttonText: '#0B0B0C',
};

export const MIN_TOUCH = 64; // well above the 44pt HIG minimum

interface BigButtonProps {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  selected?: boolean;
  testID?: string;
}

export function BigButton({ label, hint, onPress, disabled, tone = 'primary', selected, testID }: BigButtonProps) {
  const state: AccessibilityState = { disabled: !!disabled };
  if (selected !== undefined) state.selected = selected;
  const bg = tone === 'primary' ? colors.accent : tone === 'danger' ? colors.danger : colors.surface;
  const fg = tone === 'secondary' ? colors.text : colors.buttonText;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={state}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        tone === 'secondary' && styles.outlined,
      ]}
    >
      <Text style={[styles.buttonText, { color: fg }]} maxFontSizeMultiplier={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Text block for status. `accessibilityLiveRegion` is Android-only; on iOS we announce explicitly. */
export function Status({ children, tone = 'normal' }: { children: ReactNode; tone?: 'normal' | 'error' | 'ok' }) {
  const color = tone === 'error' ? colors.danger : tone === 'ok' ? colors.ok : colors.text;
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.status, { color }]}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

/** Labeled, visually distinct banner so demo/empty states are never mistaken for real data. */
export function DemoBanner({ children }: { children: ReactNode }) {
  return (
    <View accessible accessibilityRole="text" style={styles.banner}>
      <Text style={styles.bannerTitle}>Demo state — no real data</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

/** Persistent audio controls: Stop speech / Repeat last message. */
export function AudioBar() {
  const { stop, repeat, speaking, lastMessage, speechError } = useSpeech();
  return (
    <View style={styles.audioBar}>
      {speechError ? <Status tone="error">{speechError}</Status> : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <BigButton
            label="Stop speech"
            hint="Stops anything the app is saying"
            tone="danger"
            onPress={stop}
            disabled={!speaking}
          />
        </View>
        <View style={styles.flex}>
          <BigButton
            label="Repeat"
            hint={lastMessage ? `Repeats: ${lastMessage}` : 'Nothing to repeat yet'}
            tone="secondary"
            onPress={repeat}
            disabled={!lastMessage}
          />
        </View>
      </View>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      <AudioBar />
    </SafeAreaView>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16 },
  button: {
    minHeight: MIN_TOUCH,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outlined: { borderWidth: 2, borderColor: colors.text },
  buttonText: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  status: { fontSize: 20, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 28, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 18, lineHeight: 26 },
  banner: { borderWidth: 2, borderColor: colors.accent, borderRadius: 12, padding: 14, gap: 6 },
  bannerTitle: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  audioBar: { padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.surface, backgroundColor: colors.bg },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});

import { Platform, StyleSheet, Text, View } from 'react-native';
import { BigButton, colors } from '../ui/components';
import { clockTime, type FeedEntry } from './directionFeed';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const VISIBLE_HISTORY = 8;

/**
 * Debug text feed shown under the camera preview: every assessment, whether it
 * was announced, and why not. Visual evidence for screen recordings when audio
 * is off or routed to VoiceOver. It doesn't announce itself (no live region),
 * so it never competes with the spoken cues.
 */
export function DirectionFeed({ entries, onClear }: { entries: FeedEntry[]; onClear: () => void }) {
  const [latest, ...older] = entries;
  return (
    <View style={s.box}>
      <Text style={s.title} accessibilityRole="header">
        Live directions (debug)
      </Text>
      {latest ? (
        <View
          accessible
          accessibilityLabel={`Latest: ${latest.text}. ${latest.spoken ? 'Announced' : `Not announced, ${latest.note}`}.`}
        >
          <Text style={[s.latest, !latest.spoken && s.quiet]}>
            {latest.spoken ? '🔊 ' : ''}
            {latest.text}
          </Text>
          <Text style={s.meta}>
            {clockTime(latest.at)} · frame #{latest.frameSeq ?? '–'} · {(latest.latencyMs / 1000).toFixed(1)}s
            {latest.note ? ` · ${latest.note}` : ''}
          </Text>
        </View>
      ) : (
        <Text style={s.meta}>No assessments yet. Start capture with obstacle feedback on.</Text>
      )}
      {older.length > 0 ? (
        <View accessible accessibilityLabel={`${older.length} earlier entries`} style={s.history}>
          {older.slice(0, VISIBLE_HISTORY).map((e) => (
            <Text key={e.id} style={[s.line, !e.spoken && s.quiet]} numberOfLines={2}>
              {clockTime(e.at)} #{e.frameSeq ?? '–'} {(e.latencyMs / 1000).toFixed(1)}s {e.spoken ? '🔊' : '·'} {e.text}
              {e.note ? ` (${e.note})` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {entries.length > 0 ? <BigButton label="Clear feed" tone="secondary" onPress={onClear} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.surface },
  title: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  latest: { color: colors.text, fontSize: 22, fontWeight: '700' },
  quiet: { color: colors.muted, fontWeight: '400' },
  meta: { color: colors.muted, fontSize: 14, fontFamily: MONO },
  history: { gap: 4, borderTopWidth: 1, borderTopColor: colors.bg, paddingTop: 6 },
  line: { color: colors.text, fontSize: 13, fontFamily: MONO },
});

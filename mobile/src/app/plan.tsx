import { useSpeech } from '../audio/SpeechProvider';
import { BigButton, Body, DemoBanner, Heading, Screen } from '../ui/components';

/**
 * Milestone 1: empty state only. The spoken interview, real session
 * recommendations, and routes arrive in a later milestone (see
 * PlannerResult in shared/contracts.ts).
 */
export default function PlanScreen() {
  const { speak } = useSpeech();
  const message =
    'Planning is not available yet. No conference sessions are loaded, and nothing on this screen is real schedule data.';
  return (
    <Screen>
      <Heading>Plan my day</Heading>
      <DemoBanner>
        No KubeCon North America 2026 sessions are loaded. The spoken interview, session recommendations, and routes
        will come in a later version. Nothing here is real schedule data.
      </DemoBanner>
      <Body>Planned: a spoken conversation about your interests, then a recommended day you can revise by voice.</Body>
      <BigButton label="Hear status" hint="Reads the planning status aloud" onPress={() => void speak(message)} />
    </Screen>
  );
}

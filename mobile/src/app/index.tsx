import { router } from 'expo-router';
import { useSpeech } from '../audio/SpeechProvider';
import { BigButton, Body, Heading, Screen } from '../ui/components';

export default function Home() {
  const { speak } = useSpeech();
  return (
    <Screen>
      <Heading>Conference companion</Heading>
      <Body>Early prototype for KubeCon North America 2026. Choose one of three options.</Body>
      <BigButton label="Plan" hint="Talk or type to plan your day from the official schedule." onPress={() => router.push('/plan')} />
      <BigButton
        label="Navigate"
        hint="Opens the rear camera for spoken hints about obstacles, people standing in the way, and nearby openings."
        onPress={() => router.push('/navigate')}
      />
      <BigButton label="Help" hint="Device checks for speech, microphone, and backend." onPress={() => router.push('/help')} />
      <BigButton
        label="What can this app do?"
        tone="secondary"
        onPress={() =>
          void speak(
            'This is a hackathon prototype. Plan lets you talk about your interests and suggests real sessions from the official schedule. Navigate uses the camera to announce obstacles, people standing in your way, and the nearest visible opening. It can miss things and never confirms a path is safe. Help lets you test speech and the microphone. Requesting staff help is not built yet.',
          )
        }
      />
    </Screen>
  );
}

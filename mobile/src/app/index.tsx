import { router } from 'expo-router';
import { useSpeech } from '../audio/SpeechProvider';
import { BigButton, Body, Heading, Screen } from '../ui/components';

export default function Home() {
  const { speak } = useSpeech();
  return (
    <Screen>
      <Heading>Conference companion</Heading>
      <Body>Early prototype for KubeCon North America 2026. Choose one of three options.</Body>
      <BigButton label="Plan" hint="Plan your conference day. Not available yet." onPress={() => router.push('/plan')} />
      <BigButton
        label="Navigate"
        hint="Opens the rear camera. Frames are captured but not analyzed yet."
        onPress={() => router.push('/navigate')}
      />
      <BigButton label="Help" hint="Device checks for speech, microphone, and backend." onPress={() => router.push('/help')} />
      <BigButton
        label="What can this app do?"
        tone="secondary"
        onPress={() =>
          void speak(
            'This is an early prototype. Navigate shows the camera and can capture photos, but does not analyze them yet. Plan and staff help are not built yet. Help lets you test speech and the microphone.',
          )
        }
      />
    </Screen>
  );
}

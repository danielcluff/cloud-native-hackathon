import { setAudioModeAsync } from 'expo-audio';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SpeechProvider } from '../audio/SpeechProvider';
import { colors } from '../ui/components';

export default function RootLayout() {
  useEffect(() => {
    // Best effort: lets our audio play with the silent switch on. Device TTS
    // (expo-speech) may still be silent in silent mode — see README.
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <SpeechProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontSize: 20, fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Home' }} />
          <Stack.Screen name="plan" options={{ title: 'Plan' }} />
          <Stack.Screen name="navigate" options={{ title: 'Navigate' }} />
          <Stack.Screen name="help" options={{ title: 'Help' }} />
        </Stack>
      </SpeechProvider>
    </SafeAreaProvider>
  );
}

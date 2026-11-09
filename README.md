# Cloud Native Hackathon — Accessible Conference Companion

An iPhone-first conference companion for blind and low-vision attendees at
KubeCon + CloudNativeCon North America 2026. It's built during a six-hour hackathon.

> **Status: milestone 1 (foundation).** The app has real camera, microphone,
> playback and speech controls. It has **no AI analysis, no conference data and
> no staff messaging yet**. Every screen says so.

Planned flagship features for later milestones:

1. **Spoken planning interview.** Jarvis-style voice conversation that learns your
   interests, recommends real sessions from the official schedule, accepts
   revisions, and plans routes through the day.
2. **Foreground obstacle feedback.** About one camera frame per second goes to
   OpenAI Decisions for visible-obstacle assessment, which comes back as concise
   spoken feedback. Map routes and landmarks the user confirms set the direction.
   The app does not trust indoor GPS. A camera result never claims a path is safe.
3. **Event-assistant request (simulated).** A request UI with a confirmed location and
   a clearly labelled fake ETA. It never messages real staff.

## Repository layout

```
mobile/   Expo (SDK 58) + React Native + TypeScript app, Expo Router (src/app)
server/   Minimal Node 24 TypeScript backend (no framework, no runtime deps)
shared/   Type-only contracts used by both (shared/contracts.ts)
docs/     Handoff notes and sponsor integration notes
```

## Prerequisites

- Node.js **24** (22.18+ also works; the backend relies on Node's built-in TypeScript type stripping)
- An iPhone with **Expo Go** from the App Store, on the same Wi-Fi as your Mac
- No OpenAI key and no Apple signing are needed for milestone 1

## Run it

### 1. Backend

```bash
cd server
npm install
cp .env.example .env    # optional; OPENAI_API_KEY is unused in milestone 1
npm start               # http://0.0.0.0:8787
curl http://localhost:8787/health
```

### 2. Mobile app on iPhone (Expo Go)

```bash
cd mobile
npm install
cp .env.example .env    # set EXPO_PUBLIC_BACKEND_URL=http://<your-mac-LAN-IP>:8787
npx expo start
```

To find your Mac's LAN IP, run `ipconfig getifaddr en0`.

Scan the QR code with the iPhone **Camera** app, then open it in Expo Go.
If your network blocks LAN traffic, use `npx expo start --tunnel` for the app.
The backend URL still has to be reachable from the phone.

Everything milestone 1 uses (`expo-camera`, `expo-audio`, `expo-speech`,
`expo-file-system`, `expo-router`) is bundled in Expo Go.

### 3. Checks

```bash
cd mobile && npm run typecheck && npm test
cd mobile && npx expo export --platform ios     # bundles the JS; no Xcode needed
cd server && npm run typecheck && npm test
```

## What to try on the phone

- **Home**: Plan, Navigate, Help. Each is a large button with a VoiceOver label and hint.
- **Navigate**:
  - Asks for camera permission. If you denied it earlier, it offers **Open Settings**.
  - Shows the rear camera preview.
  - **Take one photo** captures a single frame.
  - **Start/Stop capture** runs a loop at about one frame per second. Captures never overlap.
  - Diagnostics show the frame count, last frame age, capture time, dropped frames and errors.
  - Capture stops automatically when you leave the screen or the app goes to the background.
  - Each frame is deleted right after it's handed to the (empty) consumer. Nothing is uploaded or analyzed.
- **Help**:
  - **Test speech** uses device text-to-speech.
  - **Record** captures up to 10 seconds from the microphone. Speech pauses while it records.
  - **Play recording** plays the clip through the loudspeaker.
  - **Check backend** calls `/health`.
- **Every screen** has **Stop speech** and **Repeat** at the bottom.
- When VoiceOver is on, status changes go through VoiceOver announcements instead of TTS, so the two don't talk over each other.

## Known limitations

- **iOS silent mode and speech:** Expo documents that `expo-speech` on a
  physical iOS device *won't produce sound if the device is in silent mode*.
  The app sets `playsInSilentMode: true` for its own audio session, but don't
  rely on that for TTS. Tell testers to flip the Ring/Silent switch to ring
  (or turn off Silent mode in Control Center) and turn the volume up.
- The iOS Simulator has no camera. Camera checks need a physical iPhone.
- There's no Xcode on the dev Mac (macOS 15.7, and the current Xcode doesn't
  support it), so `npx expo run:ios` and the iOS Simulator aren't available.
  The project is built to need neither: test on a physical iPhone with Expo Go.

## Voice plan: push-to-talk in Expo Go (milestone 2)

**Decision (2026-11-09):** the voice interview is **turn-based push-to-talk that
runs in Expo Go**. There's no live WebRTC session and no native build. The dev
Mac can't install a current Xcode (macOS 15.7, not enough disk space, limited
download capacity), and Expo Go doesn't include `react-native-webrtc`.

How one turn works:

1. The user presses and holds **Talk** (or taps once to start and once to stop).
   The app records with `expo-audio`, using the same code as the Help screen's
   mic check. Recording first stops speech and playback through the audio
   coordinator.
2. The app uploads the clip to the backend (`POST /v1/voice/turn`, our own
   endpoint). The OpenAI key stays on the server.
3. The backend:
   - converts speech to text with OpenAI
   - runs the planner turn with the interview state and verified schedule data
   - returns the reply text, plus the `PlannerResult` when recommendations change.

   Check the current OpenAI docs for the speech-to-text and model APIs before
   coding. Don't guess the schemas.
4. The app speaks the reply with device TTS. **Repeat** and **Stop speech**
   already work for this.

   Device TTS can be silent when the iPhone is on silent, so a later option is
   for the backend to return synthesized audio and play it through `expo-audio`
   with `playsInSilentMode`.

Trade-off: turn latency is roughly a few seconds per exchange, and the user
can't interrupt mid-sentence except with Stop speech. In return, there's no
signing, no Xcode and no dev build. The camera/obstacle feature is unaffected;
it never needed a native build.

Later upgrade, only if time and an Apple Developer account allow: a true
Realtime voice session over WebRTC through an **EAS cloud development build**
(`npx eas-cli@latest build --profile development --platform ios`, which needs
no local Xcode). It would add `react-native-webrtc`,
`@config-plugins/react-native-webrtc` and `expo-dev-client`. The backend would
mint the short-lived Realtime credential.

See [docs/milestone-1-handoff.md](docs/milestone-1-handoff.md) for architecture,
validation results and next steps.

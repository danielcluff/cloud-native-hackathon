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
- This machine's active developer directory is Command Line Tools, not Xcode,
  so `npx expo run:ios` and the simulator aren't available here until Xcode is
  installed and selected (`sudo xcode-select -s /Applications/Xcode.app`).

## Path to real Realtime voice (milestone 2+)

OpenAI Realtime over **WebRTC** on iPhone needs native WebRTC
(`react-native-webrtc` with `@config-plugins/react-native-webrtc`). That native
module is **not in Expo Go**, so you need an Expo **development build**:

```bash
cd mobile
npx expo install react-native-webrtc @config-plugins/react-native-webrtc expo-dev-client
# add "@config-plugins/react-native-webrtc" to app.json plugins
npx expo run:ios --device     # needs Xcode + an Apple ID signing team, cable or same network
# or: npx eas-cli@latest build --profile development --platform ios
```

The backend mints the short-lived Realtime client credential. The long-lived
`OPENAI_API_KEY` never goes into the app. Check the current OpenAI WebRTC guide
for the exact endpoint and model before you implement this. Keep the Expo Go
capability check (Help screen) working as a fallback that needs no dev build.

See [docs/milestone-1-handoff.md](docs/milestone-1-handoff.md) for architecture,
validation results and next steps.

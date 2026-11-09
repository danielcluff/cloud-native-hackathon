# Milestone 1 handoff: iPhone foundation

Branch: `codex/initial-mobile-foundation`. The work is uncommitted, and nothing has been pushed, merged or deployed.

## Scope delivered

| Requirement | Where |
| --- | --- |
| Expo SDK 58 + React Native 0.88 + TypeScript, Expo Router | `mobile/` |
| Accessible shell: Home → Plan / Navigate / Help; large controls (min 64 pt); VoiceOver labels, hints and states; header roles; persistent **Stop speech** and **Repeat** bar | `mobile/src/app/*`, `mobile/src/ui/components.tsx` |
| Labelled demo/empty states (no conference data) | `DemoBanner` on Plan, Navigate, Help |
| Rear camera permission (ask, or Open Settings when blocked), preview, manual capture, ~1 fps loop without overlap, diagnostics | `mobile/src/app/navigate.tsx`, `mobile/src/capture/*` |
| Capture stops on leaving the screen (`useFocusEffect`), on backgrounding (`AppState`) and on unmount; the camera view unmounts too | `navigate.tsx`, `useCaptureLoop.ts` |
| Transient frames only: each file is deleted after the consumer finishes, or straight away if it's stale or dropped; frames are never logged or uploaded | `captureLoop.ts`, `discardCapture` |
| `FrameConsumer` seam for the future vision API (`consume(frame, AbortSignal)`, latest-wins) | `captureLoop.ts` |
| Mic permission (ask, then Open Settings when blocked), record ≤10 s, playback, stop | `mobile/src/audio/useMicCheck.ts`, `help.tsx` |
| Device TTS with stop and repeat; uses VoiceOver announcements when VoiceOver is on | `mobile/src/audio/SpeechProvider.tsx` |
| Audio coordination: recording stops TTS and playback first; TTS and playback are refused while recording; record mode is turned off afterwards so playback uses the loudspeaker | `mobile/src/audio/audioCoordinator.ts` |
| Backend: `GET /health`, server-only `OPENAI_API_KEY`, request bodies never logged | `server/src/*` |
| Integration seams: `POST /v1/vision/assess` and `POST /v1/planner/recommend` return **501 + `state: 'unavailable'`**, never a fake result | `server/src/app.ts` |
| Typed contracts with `unavailable / pending / unknown / ok / stale / error` states | `shared/contracts.ts` |
| `.env.example` files with placeholders; `.env` is gitignored at root, `mobile/` and `server/` | |

## Architecture

```
iPhone (Expo Go)                                     Mac / later k8s
┌────────────────────────────────────────┐          ┌──────────────────────────┐
│ Expo Router Stack                       │          │ server/ (node:http, TS)  │
│  index ─ plan ─ navigate ─ help         │  HTTP    │  GET  /health            │
│                                         │ ───────► │  POST /v1/vision/assess  │ 501 unavailable
│ SpeechProvider (expo-speech)            │          │  POST /v1/planner/...    │ 501 unavailable
│ AudioCoordinator (speech/rec/playback)  │          │  OPENAI_API_KEY server-only
│ useMicCheck (expo-audio)                │          └──────────────────────────┘
│ CaptureLoop ◄─ useCaptureLoop ◄─ CameraView (expo-camera)
│   └─ FrameConsumer (noop today)         │
└────────────────────────────────────────┘
shared/contracts.ts: type-only, imported with `import type` (erased by Babel, so Metro never resolves it)
```

### Capture loop design (`mobile/src/capture/captureLoop.ts`)

- **No overlap:** the next tick is scheduled only after the current capture
  settles, with a delay of `max(0, interval − elapsed)`. `captureOnce()` won't
  run while a capture is in flight.
- **Generation counter:** `stop()` bumps the generation, clears the timer and
  aborts the consumer's `AbortSignal`, then waits for any in-flight capture.
  A frame that lands after stop is discarded and never reaches the consumer.
- **Latest wins:** the consumer runs detached, so a slow network call doesn't
  hold up capture. While it's busy, new frames are dropped (counted in
  `dropped`) instead of queued, which keeps memory and the age of the next
  analyzed frame bounded.
- **Pure TS**, so `node --test` covers it without a device.

## Changed files

All files are new; the repo had no commits. Daniel's `.mcp.json`, `.gitar/` and
`docs/sponsor-integrations.md` were left untouched.

```
.gitignore
README.md
docs/milestone-1-handoff.md
shared/contracts.ts
server/{package.json,tsconfig.json,.env.example,.gitignore}
server/src/{main.ts,app.ts,config.ts,app.test.ts}
mobile/  (create-expo-app blank-typescript, then:)
  app.json, package.json, tsconfig.json, .gitignore, .env.example
  src/app/{_layout,index,plan,navigate,help}.tsx
  src/ui/components.tsx
  src/config.ts
  src/audio/{SpeechProvider.tsx,useMicCheck.ts,audioCoordinator.ts,audioCoordinator.test.ts}
  src/capture/{captureLoop.ts,captureLoop.test.ts,useCaptureLoop.ts}
  (removed scaffold App.tsx, index.ts; entry is expo-router/entry)
```

The scaffold also created `mobile/AGENTS.md`, `mobile/.claude/settings.json` (enables the Expo plugin) and `mobile/LICENSE`. They were kept as generated.

## Validation

All checks below ran on Daniel's Mac (macOS 15 / Darwin 24.6, Node 24.19.0) on 2026-11-09.

| Check | Result |
| --- | --- |
| `mobile: npx tsc --noEmit` | ✅ pass |
| `mobile: npx expo lint` (eslint-config-expo 58, React Compiler rules) | ✅ 0 problems (the first run found 11 ref/setState-in-render issues, all fixed) |
| `mobile: npm test` (node --test) | ✅ 9/9: capture loop never overlaps, paces to the interval, stop during an in-flight capture discards the frame and schedules nothing, every frame file is discarded, slow consumer drops instead of queuing, stop aborts the consumer, capture errors are counted and the loop recovers, `captureOnce` won't overlap; audio coordinator preemption and refusal rules |
| `mobile: npx expo export --platform ios` | ✅ Hermes bundle, 2.6 MB |
| Bundle secret scan (`strings` on the .hbc) | ✅ 0 hits each for `OPENAI_API_KEY` and `sk-…` |
| `mobile: npx expo-doctor` | ⚠️ 19/20 pass. Patch mismatches (see below) |
| `server: npm run typecheck` | ✅ pass |
| `server: npm test` | ✅ 3/3: health OK, key never in the response, placeholder key counts as not configured, vision seam returns 501 `unavailable`, request body and key never logged |
| Live backend: `curl /health` | ✅ HTTP 200 `{"status":"ok",…}`. `POST /v1/vision/assess` gave HTTP 501 `unavailable`. The log shows only method, path, status and timing. (`integrations.openai` said `configured` because `OPENAI_API_KEY` is set in Daniel's shell environment. Only its presence was reported.) |

**Not verified (no hardware or simulator was used):**
- The app has **not been run on an iPhone or in the iOS Simulator**. Xcode isn't selected on this Mac, and the camera needs a physical device anyway.
- Camera preview, real 1 fps timing on device, and file deletion on iOS are untested.
- Recording and playback routing (loudspeaker after `allowsRecording: false`) is untested.
- VoiceOver reading order and announcements, TTS in silent mode, and stop-on-background are untested.

**Dependency note:** Daniel's npm config sets `min-release-age = 7`. I kept that
policy, so these are one patch behind what `expo install` asked for:
`expo-constants 58.0.14`, `expo-linking 58.0.15`, `expo-router 58.0.29`,
`react-native-safe-area-context 5.11.0`, and `expo` stays at `58.0.22`. All
are SDK 58 patch releases. Run `npx expo install --check` after the newer
patches age past 7 days.

`react-dom` is pinned to `19.3.0` to match `react` exactly. Otherwise
expo-router's optional web peer pulls in 19.3.1 and causes an ERESOLVE
conflict. `npm audit` reports 15 moderate advisories in the dev toolchain;
these weren't triaged.

## Blockers / needs Daniel

1. **Physical iPhone run:** open the project in Expo Go (see the README) and
   check the items under "Not verified" above. You don't need an account or
   signing for this.
2. **Xcode:** `xcode-select` points at Command Line Tools, so there's no
   simulator and no `expo run:ios`. Real Realtime voice needs a development
   build, which needs Xcode (or EAS) and an Apple signing team. Only Daniel can
   do that.

## Next steps for Codex (milestone 2+)

1. **Vision:**
   - Implement `POST /v1/vision/assess` against OpenAI Decisions. As fetched on
     2026-11-09, that's `POST /v1/decisions`, model `gpt-6-luna`, image input
     as a base64 data URL or HTTPS URL, and `predicate`/`choice`/`score`
     questions that return `answers[]` with probabilities. **Re-check the docs
     before coding.**
   - Map the answers into `VisionAssessment` with server-side phrase templates,
     and return `unknown` below a confidence threshold.
   - On mobile, add an `HttpFrameConsumer`: read the frame as base64 (or
     multipart), POST with the `AbortSignal` and a ~2 s timeout, mark results
     older than `VISION_STALE_AFTER_MS` as `stale`, and speak only fresh,
     changed hazards.
   - Never say "clear" or "safe". At most, say "no obstacles detected in view".
   - 1 fps is about 3,600 requests per hour per user. Watch cost and rate
     limits, and consider pausing the loop while the scene hasn't changed.
2. **Realtime voice interview:**
   - Add `react-native-webrtc` + `@config-plugins/react-native-webrtc` +
     `expo-dev-client` and make a development build.
   - The backend mints the ephemeral Realtime credential. Use the current
     OpenAI WebRTC guide linked from the voice-agents page. The guessed URL
     `/api/docs/guides/realtime-webrtc` returned 404, so find the real link
     there.
   - Route the planner tools through backend endpoints that return `PlannerResult`.
   - Keep the Help screen's Expo Go capability check as the non-dev-build fallback.
3. **Planner data:**
   - Ingest the official KubeCon NA 2026 schedule, with a `sourceUrl` on every
     session.
   - Build route steps from the venue map, with landmarks the user confirms.
4. **Simulated event assistant:** add a Help request UI with location
   confirmation and a fake ETA labelled "Simulation — no staff contacted".
5. **Sponsors:** add OpenTelemetry to the backend for Dash0 (see
   `docs/sponsor-integrations.md`, and never record payloads), then a Dockerfile
   and Kubernetes manifests for Radar.

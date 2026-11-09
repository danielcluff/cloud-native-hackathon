# Deploying the backend to the Radar hackathon cluster `daniel-cluff`

The backend runs on the Radar-provisioned team cluster **`daniel-cluff`**, a
vcluster in Radar Cloud. It's public at **https://daniel-cluff.cnh.radarhq.io**.
This follows the GitOps flow of the official starter
([skyhook-io/cnh-starter](https://github.com/skyhook-io/cnh-starter)):

```
push to main ─► GitHub Action: test ─► build linux/amd64+arm64 image ─► ghcr.io/…/conference-assistant-api:<sha7>
                                  └─► "deploy:" commit bumps deploy/kustomization.yaml newTag
Argo CD watches main:deploy/ ─► syncs into team-daniel-cluff ─► platform routes the URL to Service app:80
```

| Piece | File / value |
| --- | --- |
| Image | `ghcr.io/danielcluff/cloud-native-hackathon/conference-assistant-api` (public, amd64 + arm64) |
| CI | `.github/workflows/backend-image.yml` |
| Manifests | `deploy/backend.yaml` (Deployment **`app`**, selector `app: app`, and Service **`app` port 80**), `deploy/httproute.yaml`, `deploy/kustomization.yaml` (namespace `team-daniel-cluff`) |
| Argo CD Application | `argocd/application.yaml`: name `app`, namespace and project `team-daniel-cluff` |
| Secret (not in git) | `conference-assistant-api` in `team-daniel-cluff`, keys `OPENAI_API_KEY` and **`APP_ACCESS_TOKEN`** (required) |
| Public URL | https://daniel-cluff.cnh.radarhq.io (platform-managed TLS) |

Agent procedures for this cluster (ship, debug, canary, demo story) are in
`AGENTS.md` and `.agents/skills/`, adapted from the hackathon starter
[danielcluff/cnh-radar](https://github.com/danielcluff/cnh-radar).

Platform rules from the starter that this layout follows:
- The platform routes the team URL to **Service `app`, port 80**, in
  `team-daniel-cluff`. Don't rename it.
- There are no LoadBalancer or NodePort Services. The HTTPRoute is inert inside
  the vcluster, but it's kept as the starter does.
- Argo CD picks up Applications in `team-*` namespaces, using project
  `team-<team-name>`.
- Don't upgrade or touch the `radar` namespace.
- Budget across the whole cluster: 2 CPU / 4 GiB of requests and 4 CPU / 8 GiB
  of limits. The backend asks for 50m / 64Mi and is capped at 500m / 256Mi.
- Our Deployment is named `app` with selector `app: app`, the same as the
  starter's, because Argo CD updates it in place and a selector can't change.

## Status (2026-11-09)

| Step | State |
| --- | --- |
| `main` is the default branch; the first `backend-image` run built `9c2db02` and committed `deploy: … 9c2db02` | ✅ |
| GHCR package is public; anonymous pull works for `linux/amd64` and `linux/arm64` | ✅ |
| The fresh OpenAI key works (live voice turn and Decisions call succeeded) | ✅ |
| `https://daniel-cluff.cnh.radarhq.io` is live and still serving the **starter app** | ✅ checked |
| Claude's Radar MCP can see `daniel-cluff` | ✅ Org "Cloud Native Hackathon", cluster id `Bz1Wh8FsXMU`. Only ever call tools with this id. |
| Live state (read-only check) | The starter Deployment `app` (2/2, `node:22-alpine`, selector `app: app`) is running. There's no Argo CD Application `app` yet and no Secrets. A server-side dry run of our Deployment against the cluster passed validation. |
| Secret created in `team-daniel-cluff` (both keys) | ⏳ Daniel |
| Argo CD Application applied | ⏳ after the manifests reach `main` |

## 1. Get these manifests onto `main`

Merge the PR that contains this doc. Argo CD deploys whatever is in
`main:deploy/`. Changes that only touch `deploy/` don't rebuild the image;
they just sync.

## 2. Create the Secret

The Secret holds two values. Create it **before** the first sync:
- `OPENAI_API_KEY`: the server-only OpenAI key.
- `APP_ACCESS_TOKEN`: the pairing token that only your phone knows. It's
  **required**; without it the pod refuses to start rather than serving the
  public URL with no authentication.

Generate the pairing token on your Mac and keep it in your password manager:

```bash
openssl rand -hex 32
```

**From the Radar Cloud UI:** open cluster `daniel-cluff` → namespace
`team-daniel-cluff` → create Secret `conference-assistant-api` with both keys.

**Or with kubectl**, using the team kubeconfig (per the starter it's stored in
Secret `kubeconfig` in namespace `default`; save it outside the repo). This
reads both values without echoing them:

```bash
export KUBECONFIG=~/cnh-kubeconfig
read -rs OPENAI_API_KEY && read -rs APP_ACCESS_TOKEN && \
  kubectl -n team-daniel-cluff create secret generic conference-assistant-api \
    --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" --from-literal=APP_ACCESS_TOKEN="$APP_ACCESS_TOKEN" && \
  unset OPENAI_API_KEY APP_ACCESS_TOKEN
```

Argo CD won't prune this Secret, because it didn't create it. To rotate the
token, update the Secret, restart the Deployment, and paste the new token on
the phone.

Optional env in the Deployment:
- Model overrides: `OPENAI_VISION_MODEL` (default `gpt-6-luna`),
  `OPENAI_TRANSCRIBE_MODEL` (`gpt-transcribe`) and `OPENAI_TEXT_MODEL`
  (`gpt-6.1-sol`), and `OPENAI_TEXT_REASONING_EFFORT` (`low`; `default` uses the
  model's own, which roughly doubles planning latency). Measured on 2026-11-09:
  `gpt-6.1-sol` low 2.9-4.8 s per planning call, versus 5-10 s for `gpt-6-astra`.
- Usage caps: `LIMIT_VISION_PER_MINUTE` (70), `LIMIT_VISION_PER_DAY` (3000),
  `LIMIT_VOICE_PER_MINUTE` (10) and `LIMIT_VOICE_PER_DAY` (300).

## 3. Apply the Argo CD Application (takes over the starter app)

**Wait for the new image first.** Merging this PR changes `server/`, so the
workflow builds a new image (backend `0.3.0`, with pairing and caps) and pushes
a `deploy:` commit to `main`. Apply the Application only after that commit
exists. The older `9c2db02` image ignores `APP_ACCESS_TOKEN` and would serve
the public URL without authentication.

Do this with Radar MCP `apply_resource` (ask the agent, once it can see
`daniel-cluff`), the Radar Cloud UI, or:

```bash
kubectl apply -f argocd/application.yaml
kubectl -n team-daniel-cluff get application app -w   # wait for Synced / Healthy
```

Because it's named `app` and uses `prune: true`, Argo CD replaces the starter's
Deployment and Service with ours.

## 4. Verify

```bash
curl -s https://daniel-cluff.cnh.radarhq.io/health
# {"status":"ok","service":"cnh-backend","version":"0.3.0","commit":"<sha7>",...,"integrations":{"openai":"configured"},"auth":"token"}
curl -s -o /dev/null -w "%{http_code}\n" https://daniel-cluff.cnh.radarhq.io/v1/auth/check
# 401  (no token: refused)
```

In Radar, check that the Application `app` is Synced/Healthy. `/health`'s `commit`
must equal the tag in the latest `deploy:` commit. For the sponsor demo, run a
Radar investigation against Deployment `app`. See `.agents/skills/demo-story`.

Then check that the pod can reach the outside services:

```bash
kubectl -n team-daniel-cluff exec deploy/app -- \
  node -e "fetch('https://sessionize.com/api/v2/svi82w6c/view/All').then(r=>console.log(r.status))"
```

## 5. Point the iPhone at it and pair it

1. Nothing to configure: the app uses `https://daniel-cluff.cnh.radarhq.io` by
   default (`mobile/src/config.ts`), and Help → **Backend check** shows the URL in use.
   A `mobile/.env` with `EXPO_PUBLIC_BACKEND_URL` overrides it, for a local backend only.
2. Get the pairing token onto the phone. Copy it on the Mac and paste on the
   iPhone with Universal Clipboard, or AirDrop it as a note.
3. In the app, open Help → **Pair this phone**, paste the token, then tap
   **Save and check**. It should say "Paired". The token is stored in the iOS
   keychain (this device only, never backed up) and is sent only as an
   `Authorization` header to the backend.
4. Help → **Check backend** should report "Pairing required".

The public URL is HTTPS, so the phone works over cellular or any Wi-Fi.

## Access control and spend limits

Anyone can reach the URL, so the backend protects the paid endpoints:

| Control | Behavior |
| --- | --- |
| Pairing token | Every `/v1/*` call needs `Authorization: Bearer <APP_ACCESS_TOKEN>`. Without it the response is 401 and the app says "not paired". `/health` stays open and shows only `auth: "token"`. The comparison is constant-time, and the token is never logged. |
| Usage caps | In memory, per replica. Vision: 70/min and 3,000/day. Voice turns: 10/min and 300/day. Over a cap the response is 429 with a spoken reason. Daily caps reset at midnight UTC. |
| OpenAI key scope | Restrict the key to the three endpoints below. |

**OpenAI endpoints and models this backend uses** (for key or project
allowlists):

| Feature | Endpoint | Model (default) |
| --- | --- | --- |
| Obstacle checks (Navigate) | `POST /v1/decisions` | `gpt-6-luna` |
| Speech-to-text (Plan, push-to-talk) | `POST /v1/audio/transcriptions` | `gpt-transcribe` |
| Planning replies (Plan) | `POST /v1/responses`, structured JSON output | `gpt-6.1-sol` |

Nothing else is called: no Realtime, embeddings, files, images or
text-to-speech. Speech output uses the phone's own voice.

This is a shared secret, not device attestation. Whoever holds the token can
use the backend, so treat it like a password. True per-device attestation
(Apple App Attest) needs a native development build, which this Expo Go
project deliberately avoids.

## Rolling back

Revert the `deploy:` commit on `main` (or set `newTag` to an earlier SHA) and
push; Argo CD syncs back to that image. Deleting the Application with `prune`
removes the Deployment and Service but not the Secret.

## Privacy in the cluster

Logs contain only method, path, status and duration. Images, audio,
transcripts and keys are never logged. Conversation state is in memory only
(`replicas: 1`) and is lost on restart, which is fine for the hackathon. Don't
scale beyond one replica until that state moves out of memory.

## Not used: `dev-local`

The Radar org "daniel cloud native hackathon" also has `dev-local`, Daniel's
homelab Talos cluster. It isn't a deployment target for this project.

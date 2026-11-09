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
| Manifests | `deploy/backend.yaml` (Deployment `conference-assistant-api`, Service **`app` port 80**), `deploy/httproute.yaml`, `deploy/kustomization.yaml` (namespace `team-daniel-cluff`) |
| Argo CD Application | `argocd/application.yaml`: name `app`, namespace and project `team-daniel-cluff` |
| Secret (not in git) | `conference-assistant-api`, key `OPENAI_API_KEY`, in `team-daniel-cluff` |
| Public URL | https://daniel-cluff.cnh.radarhq.io (platform-managed TLS) |

Platform rules from the starter that this layout follows:
- The platform routes the team URL to **Service `app`, port 80**, in
  `team-daniel-cluff`. Don't rename it.
- There are no LoadBalancer or NodePort Services. The HTTPRoute is inert inside
  the vcluster, but it's kept as the starter does.
- Argo CD picks up Applications in `team-*` namespaces, using project
  `team-<team-name>`.
- Don't upgrade or touch the `radar` namespace.

## Status (2026-11-09)

| Step | State |
| --- | --- |
| `main` is the default branch; the first `backend-image` run built `9c2db02` and committed `deploy: … 9c2db02` | ✅ |
| GHCR package is public; anonymous pull works for `linux/amd64` and `linux/arm64` | ✅ |
| The fresh OpenAI key works (live voice turn and Decisions call succeeded) | ✅ |
| `https://daniel-cluff.cnh.radarhq.io` is live and still serving the **starter app** | ✅ checked |
| Claude's Radar MCP can see `daniel-cluff` | ❌ The MCP session is bound to org "daniel cloud native hackathon", which only has `dev-local`. Team clusters live in the "Cloud Native Hackathon" org. Re-authenticate radar-cloud (`/mcp`) and choose that org, or apply from the Radar Cloud UI. |
| Secret created in `team-daniel-cluff` | ⏳ Daniel |
| Argo CD Application applied | ⏳ after the manifests reach `main` |

## 1. Get these manifests onto `main`

Merge the PR that contains this doc. Argo CD deploys whatever is in
`main:deploy/`. Changes that only touch `deploy/` don't rebuild the image;
they just sync.

## 2. Create the Secret

Create it **before** the first sync so the pod starts with the key.

**From the Radar Cloud UI:** open cluster `daniel-cluff` → namespace
`team-daniel-cluff` → create a Secret named `conference-assistant-api` with key
`OPENAI_API_KEY`.

**Or with kubectl**, using the team kubeconfig. Per the starter it's stored in
Secret `kubeconfig` in namespace `default`; save it outside the repo. The API
is `https://daniel-cluff.vc.cnh.radarhq.io`. Read the key without echoing it,
so it never lands in shell history:

```bash
export KUBECONFIG=~/cnh-kubeconfig
read -rs OPENAI_API_KEY && kubectl -n team-daniel-cluff create secret generic conference-assistant-api \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" && unset OPENAI_API_KEY
```

Argo CD won't prune this Secret, because it didn't create it. Without the
Secret the pod still starts and reports `openai: not_configured`.

Optional model overrides go in the Deployment env: `OPENAI_VISION_MODEL`
(default `gpt-6-luna`), `OPENAI_TRANSCRIBE_MODEL` (`gpt-transcribe`) and
`OPENAI_TEXT_MODEL` (`gpt-6-astra`).

## 3. Apply the Argo CD Application (takes over the starter app)

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
# {"status":"ok","service":"cnh-backend","version":"0.2.0",...,"integrations":{"openai":"configured"}}
```

In Radar, check that the Application `app` is Synced/Healthy and that the
image tag matches the latest `deploy:` commit. For the sponsor demo, run a
Radar investigation against the `conference-assistant-api` workload.

Then check that the pod can reach the outside services:

```bash
kubectl -n team-daniel-cluff exec deploy/conference-assistant-api -- \
  node -e "fetch('https://sessionize.com/api/v2/svi82w6c/view/All').then(r=>console.log(r.status))"
```

## 5. Point the iPhone at it

`mobile/.env`:

```
EXPO_PUBLIC_BACKEND_URL=https://daniel-cluff.cnh.radarhq.io
```

Restart `npx expo start`, then in the app use Help → **Check backend**. Because
the URL is public HTTPS, the phone can use cellular or any Wi-Fi; no
port-forward or shared network is needed.

## ⚠️ Public endpoint cost exposure

The URL is public and the API has no authentication. Anyone who finds it can
call `/v1/voice/turn` and `/v1/vision/assess`, which spends OpenAI credit.
Mitigations, in order of effort:
1. Set a hard monthly budget and alerts on the OpenAI project that owns the key.
2. Remove the Secret (or scale to 0) when you're not demoing.
3. Add a simple per-IP rate limit and/or a shared app token to the backend.
   It's not built yet; a token in the app bundle is only a speed bump, not a
   secret.

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

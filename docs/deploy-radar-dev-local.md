# Deploying the backend to Radar's `dev-local` cluster

This uses the same GitOps flow as Radar's hackathon starter
([skyhook-io/cnh-starter](https://github.com/skyhook-io/cnh-starter)):

```
push to main ─► GitHub Action: test ─► build linux/amd64+arm64 image ─► push ghcr.io/…/conference-assistant-api:<sha7>
                                  └─► "deploy:" commit bumps deploy/kustomization.yaml newTag
Argo CD (on dev-local) watches main:deploy/ ─► syncs Deployment + Service ─► Radar shows health
```

| Piece | File |
| --- | --- |
| Image build | `Dockerfile` (Node 24, non-root, read-only root FS, `node src/main.ts`) |
| CI | `.github/workflows/backend-image.yml` |
| Manifests | `deploy/backend.yaml`, `deploy/kustomization.yaml` |
| Argo CD Application | `argocd/application.yaml` (namespace `conference-assistant`, project `default`) |
| Secret (not in git) | `conference-assistant-api` with key `OPENAI_API_KEY` |

## Status (2026-11-09)

The repo side is done. Nothing has been deployed to the cluster yet. These
gaps are still open:

| # | Gap | Who |
| --- | --- | --- |
| 1 | We don't know where `dev-local` runs or how to reach it with kubectl. The only kubeconfig context on Daniel's Mac is `admin@homelab` (192.168.1.41), which is unreachable from here. The Radar MCP needs OAuth (`/mcp` → radar-cloud → Authenticate). | Daniel |
| 2 | Is Argo CD installed on `dev-local`, and in which namespace and project? A cluster made by the starter's `local-cluster.sh` uses project `team-<team-name>` and namespace `team-<team-name>`. | Check in step 0 |
| 3 | `main` doesn't exist on GitHub yet; only `codex/initial-mobile-foundation` does. The workflow and Argo CD both track `main`, so the branch needs a PR and merge. | Daniel |
| 4 | The GHCR package is private when first created. Either make it public (GitHub → Packages → conference-assistant-api → Package settings → Change visibility) or add an `imagePullSecret`. | Daniel, after the first workflow run |
| 5 | The `OPENAI_API_KEY` in Daniel's shell is **expired** (the API returned `401 expired_secret_key`). The cluster Secret needs a fresh key. | Daniel |
| 6 | The pod needs outbound HTTPS to `api.openai.com` and `sessionize.com` (the schedule feed). | Check in step 5 |

## 0. Identify the cluster

With the radar-cloud MCP authorized, ask the agent to list the clusters and
describe `dev-local`. Every Radar tool call needs the cluster ID. Then, from a
machine with kubectl access:

```bash
kubectl config get-contexts
kubectl get nodes -o wide             # node arch: arm64 or amd64 (CI builds both)
kubectl get ns argocd radar           # Argo CD + the Radar agent should exist
kubectl get appprojects -n argocd     # "default" or "team-<name>"
kubectl get applications -n argocd    # the 3 GitOps resources Radar showed
```

If it turns out `dev-local` is a k3d cluster created by the starter, use
`k3d cluster list` and `k3d kubeconfig get <name>`, and set
`spec.project` / `spec.destination.namespace` in `argocd/application.yaml`
to `team-<team-name>`.

## 1. Get the code onto `main`

Open a PR from `codex/initial-mobile-foundation` to `main` and merge it. The
first push to `main` that touches `server/`, `shared/` or `Dockerfile` runs the
workflow. You can also start it by hand under Actions → backend-image → Run
workflow.

Check that the run built `ghcr.io/danielcluff/cloud-native-hackathon/conference-assistant-api:<sha7>`
and then pushed a `deploy: conference-assistant-api <sha7>` commit.

Then make the package public (gap 4).

## 2. Create the namespace and Secret

Run this **before** the first sync so the pod starts with the key. Read the
key without echoing it, so it never lands in shell history:

```bash
kubectl create namespace conference-assistant
read -rs OPENAI_API_KEY && kubectl -n conference-assistant create secret generic conference-assistant-api \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" && unset OPENAI_API_KEY
```

Or create it in the Radar UI. Argo CD doesn't prune this Secret because it
didn't create it. The Deployment marks the key `optional: true`, so without a
key the backend still starts and reports `openai: not_configured`.

Optional model overrides go in the Deployment env: `OPENAI_VISION_MODEL`
(default `gpt-6-luna`), `OPENAI_TRANSCRIBE_MODEL` (`gpt-transcribe`) and
`OPENAI_TEXT_MODEL` (`gpt-6-astra`).

## 3. Register the Argo CD Application

```bash
kubectl apply -n argocd -f argocd/application.yaml
kubectl -n argocd get application conference-assistant-api -w   # wait for Synced / Healthy
```

## 4. Verify

```bash
kubectl -n conference-assistant rollout status deploy/conference-assistant-api
kubectl -n conference-assistant port-forward svc/conference-assistant-api 8787:8787
curl -s localhost:8787/health    # {"status":"ok",...,"integrations":{"openai":"configured"}}
```

In Radar, check that the Application is Synced/Healthy and that the
Deployment's image tag matches the latest `deploy:` commit. For the demo, run
a Radar investigation against the `conference-assistant-api` workload.

## 5. Let the iPhone reach it

`dev-local` has no public URL (the starter says to use port-forward), and the
Service is ClusterIP. For the demo:

1. On the laptop, forward on all interfaces:
   ```bash
   kubectl -n conference-assistant port-forward --address 0.0.0.0 svc/conference-assistant-api 8787:8787
   ```
2. Conference Wi-Fi often blocks device-to-device traffic. Connect the laptop
   to the **iPhone's Personal Hotspot**; the phone can always reach a laptop
   on its own hotspot.
3. Set `EXPO_PUBLIC_BACKEND_URL=http://<laptop-ip>:8787` in `mobile/.env`
   (`ipconfig getifaddr en0`, or the bridge address on the hotspot, usually
   `172.20.10.x`), then restart `npx expo start`.
4. In the app: Help → **Check backend**.

To check outbound access (gap 6), run:

```bash
kubectl -n conference-assistant exec deploy/conference-assistant-api -- \
  node -e "fetch('https://sessionize.com/api/v2/svi82w6c/view/All').then(r=>console.log(r.status))"
```

## Rolling back

Revert the `deploy:` commit on `main` (or set `newTag` to an earlier SHA) and
push; Argo CD syncs back to that image. To stop syncing entirely, run
`kubectl -n argocd delete application conference-assistant-api`. Because of
`prune`, that also removes the Deployment and Service, but not the Secret.

## Privacy in the cluster

Logs contain only method, path, status and duration. Images, audio,
transcripts and keys are never logged. Conversation state is in memory only
(`replicas: 1`) and is lost on restart, which is fine for the hackathon.
Don't scale beyond one replica until that state moves out of memory.

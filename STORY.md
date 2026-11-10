# Demo story: accessible conference companion on Radar

Team **daniel-cluff** · cluster id `Bz1Wh8FsXMU` · namespace `team-daniel-cluff` ·
https://daniel-cluff.cnh.radarhq.io

## Before

Recorded **2026-11-09 14:19 MST** (Salt Lake City) with Radar `get_cluster_audit`, scoped to
namespace `team-daniel-cluff`.
Radar Cloud: https://app.radarhq.io/checks?scope=Bz1Wh8FsXMU&namespace=team-daniel-cluff

Context: this snapshot was taken right **after** the first GitOps deploy of our backend
(image `conference-assistant-api:a2016a1`, Argo CD Application `app` Synced and Healthy).
That deploy replaced the platform's starter app in place. No audit was recorded for the
starter app itself.

**Summary:** 0 critical · 0 high · 1 medium · 0 low (1 resource, Reliability)

### Medium
- `singleReplica`: Deployment `team-daniel-cluff/app`. "Deployment has only 1 replica."
  Our deploy introduced it (the starter ran 2). It's intentional for now: the voice
  interview keeps conversation state in memory, so a second replica would split a user's
  conversation across pods. Radar's suggested fix is `replicas: 2` or an HPA, which first
  needs the state moved out of the pod (for example, Postgres from the pre-installed
  CloudNativePG operator).

Live issues at the same time (`issues`, `team-daniel-cluff`): none.

## AI investigation

Started through the Radar MCP (`start_investigation`) on **Deployment `app`** in
`team-daniel-cluff`, 2026-11-09 16:56 MST, against image `41a9e35` (graded steering).
Run `chat_1dzENloqxHrQt6eT`:
https://app.radarhq.io/c/Bz1Wh8FsXMU/investigations/chat_1dzENloqxHrQt6eT?org=org_NCJbssDGEBsU

**Verdict: healthy, no fix needed** (confidence 0.9, certainty "established").

- The single replica is ready and available. The rollout to `41a9e35` completed
  (Progressing condition: new ReplicaSet available).
- Pod logs show `/health` answering 200 every few seconds with no errors, and
  restarts are flat at 0 over the last hour.
- A brief drop in ready replicas from 2 to 1 right after the image change was the
  normal surge-then-settle of a rolling update, not a failure. No Warning events.
- The only open note is the known `singleReplica` audit finding (see Before). It's a
  resilience risk, not a current problem; we keep one replica on purpose while
  interview state lives in memory.

Context: earlier the same day, a deploy got stuck when an all-digit commit tag
(`9636345`) became a YAML number and Argo CD failed to render the manifests. Radar
flagged it as `gitops_render_failed`, `diagnose` on the Application showed the
kustomize error, and the fix (quoting the tag in CI, PR #9) rolled out as `41a9e35`.

## After

_To fill in before 5:30: re-run Checks for `team-daniel-cluff`, say what was fixed and
what's left, and link the AI investigation (see `.agents/skills/demo-story`)._

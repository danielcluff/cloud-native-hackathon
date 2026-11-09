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

## After

_To fill in before 5:30: re-run Checks for `team-daniel-cluff`, say what was fixed and
what's left, and link the AI investigation (see `.agents/skills/demo-story`)._

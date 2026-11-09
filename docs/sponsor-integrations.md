# Sponsor integrations

## Gitar by Sonar

Gitar Settings lists `danielcluff/cloud-native-hackathon` as connected and enabled for reviews. The GitHub repository was empty when verified, so the first automated review still needs a pull request. Push the initial default branch with the repository's [review instructions](../.gitar/review/accessibility-and-privacy.md), then open a feature PR and verify Gitar's review summary on GitHub. [Gitar quickstart](https://docs.gitar.ai/quickstart)

## Dash0

The Dash0 workspace and Agent0 page are accessible. The backend will use its own ingest-only credential and server-side OpenTelemetry configuration. The workspace's **Settings → Endpoints** lists US West (Oregon) OTLP HTTP ingress. Use the intended dataset. The existing auto-generated token has query, ingest, and configuration permissions. Provision a separate ingest-only token for the backend and store it in the backend's local environment or a Kubernetes Secret. Live ingest is pending that credential and server instrumentation.

```sh
export OTEL_SERVICE_NAME=conference-assistant-api
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=https://ingress.us-west-2.aws.dash0.com
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${DASH0_INGEST_TOKEN},Dash0-Dataset=default"
```

Load OpenTelemetry before the HTTP server starts. Generate a synthetic schedule request and confirm its trace, request metrics and correlated log in Dash0. Review request duration and errors by route template and outcome. Keep payloads, transcripts, images and location out of telemetry. [Dash0 Node.js integration](https://www.dash0.com/hub/integrations/int_nodejs/overview)

The repository declares the regional Dash0 MCP endpoint at `https://api.us-west-2.aws.dash0.com/mcp`. OAuth consent is still pending. After granting consent, verify access by listing services from the dataset. Use Agent0 for an investigation once the backend has telemetry. [Dash0 MCP setup](https://www.dash0.com/hub/integrations/int_dash0_mcp/overview)

## Radar Cloud

Codex has authenticated to Radar Cloud MCP at `https://api.radarhq.io/mcp`. The repository also declares that endpoint in [Claude's project MCP configuration](../.mcp.json). The current Radar workspace showed one cluster, `dev-local`, with three synced GitOps resources. A hackathon team cluster was not visible. To provision one, [Radar's team portal](https://join.cnh.radarhq.io) requires a team name, member emails, the kickoff code, and acceptance of its usage terms. The portal says other participants can see member emails. After joining, select the team cluster and use its ID for deployment operations.

Build from the repository root with `docker build -t conference-assistant-api:local .`. Run it with `docker run --rm -p 127.0.0.1:8787:8787 conference-assistant-api:local`, then check `http://127.0.0.1:8787/health`. The [Kustomize base](../deploy/kustomization.yaml) renders with `kubectl kustomize deploy`.

Once a target namespace is confirmed, publish the backend image to a registry the cluster can pull from and map `conference-assistant-api` to that image and tag in Kustomize. Configure the Argo CD Application to read this repository's `deploy` path and target the approved namespace. Create a `conference-assistant-api` Secret there for `OPENAI_API_KEY` when the OpenAI feature is enabled. Sync through Radar and verify that Argo CD shows a healthy, synced rollout and that the backend health endpoint responds. Run an investigation against the team's workload and capture the evidence for the demo. [Radar hackathon starter](https://github.com/skyhook-io/cnh-starter)

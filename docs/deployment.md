# Deployment

AgentLab ships as one Node process that serves both the API and the built lab UI.

## Docker

```bash
docker build -t agentlab .
docker run -p 8787:8787 -v agentlab-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e AGENTLAB_ADMIN_TOKEN=$(openssl rand -hex 24) \
  agentlab
```

Open http://localhost:8787 and enter the workspace token when prompted.

## Bare Node (22.13+)

```bash
npm ci
npm run build          # builds apps/web/dist
PORT=8787 npm start    # serves API + UI
```

## Environment

| variable | default | purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `AGENTLAB_DATA_DIR` | `.data` (repo root) | where `agentlab.db` lives |
| `ANTHROPIC_API_KEY` | — | enables Claude agents, LLM persona users and LLM judges |
| `AGENTLAB_SIM_MODEL` | `claude-opus-5-5` | model for simulated users |
| `AGENTLAB_JUDGE_MODEL` | `claude-opus-5-5` | model for `llm_judge` |
| `AGENTLAB_ADMIN_TOKEN` | — | locks every route except `/api/health` and `/api/ingest` |

A `.env` file at the repo root is loaded automatically.

## Security notes

- **Lock public deployments.** Without `AGENTLAB_ADMIN_TOKEN` anyone who can reach the server can use the lab.
- **HTTP agents make outbound requests** from the server to the URL in the agent version. Only register
  endpoints you trust, and run the server where it cannot reach internal services you don't want exercised.
- API keys are stored as SHA-256 hashes and shown once at creation.
- Claude-powered agents use server-side refusal fallback by default; the model that actually served each step
  is recorded in the trace (toggle per version).

## Billing

The self-hosted edition meters trials per calendar month against the selected plan and shows a projected
invoice. Plan switches apply immediately. To charge customers, report `usage_events` to your payment provider's
metered-billing API on a schedule (one meter: `trials`), keyed by workspace.

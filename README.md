# AI Agents

This directory contains **5 AI agent workflows** that orchestrate MCP servers to perform procurement-related tasks.

## How Agents Work

Each agent is a TypeScript script that:
1. Connects to required MCP servers via stdio
2. Calls tools to fetch data and perform actions
3. Logs decisions to the audit service
4. Exits

Agents are spawned with `tsx src/agents/<agent-name>.ts` and are designed to run as one-shot Docker containers.

## Agents

| File | MCP Servers Used | Purpose |
|------|-----------------|---------|
| [ocr-nlp-agent.ts](./src/agents/ocr-nlp-agent.ts) | Documents, Storage, DocumentAnalysis, NLP, Notifications, Audit | Extract and validate fields from uploaded documents |
| [anomaly-agent.ts](./src/agents/anomaly-agent.ts) | Soumissions, Anomaly, Audit | Detect anomalies (collusion, price patterns, saucissonnage) |
| [evaluation-agent.ts](./src/agents/evaluation-agent.ts) | Evaluation, Soumissions, DocumentAnalysis, LLM, Audit | Score submissions against evaluation criteria using LLM |
| [genai-cdc-agent.ts](./src/agents/genai-cdc-agent.ts) | AO, LLM, Audit | Draft CDC (Terms of Reference) sections with GenAI |
| [gre-a-gre-agent.ts](./src/agents/gre-a-gre-agent.ts) | AO, Users, Documents, Storage, DocumentAnalysis, LLM, Audit | Direct-award (grev-a-grev) compliance assessment |

## Environment Variables

See `../al-mizan-deployments/.env.ai.example` for the full list. Key variables per agent:

- `AO_ID` — tender ID
- `SUBMISSION_ID` — submission ID (ocr-nlp-agent)
- `GAG_ID`, `USER_ID`, `JUSTIFICATION_TEXT` — gre-a-gre details
- `SECTION_TYPE`, `USER_PROMPT` — CDC drafting details
- `LLM_ONPREM_ENDPOINT` or `LLM_EXTERNAL_ENDPOINT` — LLM service

## Running Agents

```bash
docker compose -f al-mizan-deployments/docker-compose.ai.yml run --rm ocr-nlp-agent
```

Or start all agents (they will exit after completing):

```bash
docker compose -f al-mizan-deployments/docker-compose.ai.yml up
```

## Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Run an agent directly
npx tsx src/agents/anomaly-agent.ts
```

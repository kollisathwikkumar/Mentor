# Dependency and secret audit — 2026-10-04

## Dependency inventory

- Production packages: `@modelcontextprotocol/sdk`, `@openzeppelin/contracts`, `react`, `react-dom`, `viem`, `zod`, `vite`, and the official Vite React plugin.
- Test/tool packages: TypeScript, Vitest + V8 coverage, Foundry Forge/Anvil binaries, and type definitions.
- Scrapling 0.4.15 (pinned in `requirements-scrapling.txt`) was installed in an ignored Python 3.12 virtual environment for local browser smoke extraction. It is a development QA tool, not a runtime backend dependency.

## Results

- `npm audit` → 0 vulnerabilities on 2026-10-04.
- `npm run audit:secrets` → pass; no credential values detected in project files.
- `package-lock.json` is the workspace lockfile; a clean `npm ci` install reproduced npm dependencies.
- `.env`, `.env.*`, Python virtualenvs, compiled JS, Foundry output, and coverage reports are ignored.

## Secret boundaries

`NVIDIA_API_KEY` and `MANDATE_AGENT_PRIVATE_KEY` are backend-only environment variables. The browser bundle receives only a public contract address and deployment block. The model adapter uses a bounded HTTPS request, no logging, and no deterministic-test API calls. Do not check in a populated `.env` or paste a live provider credential into source files.

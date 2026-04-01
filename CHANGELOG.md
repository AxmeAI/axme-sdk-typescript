# Changelog

## [v0.2.0] - 2026-04-01

### Added
- **Agent Mesh module** - MeshClient with heartbeat, startHeartbeat, stopHeartbeat, reportMetric, listAgents, getAgent, kill, resume, listEvents
- Mesh module wired as `client.mesh` property (lazy init)
- Dashboard URL: mesh.axme.ai

## 0.1.2 (2026-03-18)

### Bug Fixes
- Fix `main` and `types` paths in package.json (`dist/index.js` → `dist/src/index.js`). Importing `@axme/axme` now resolves correctly.

### Features (added in 0.1.1, first changelog entry)
- `listen(address, options)` — AsyncGenerator for agent intent stream (SSE)
- `observe(intentId, options)` — AsyncGenerator for intent lifecycle events
- `waitFor(intentId, options)` — wait for terminal intent state
- `sendIntent(payload, options)` — convenience wrapper with auto-generated correlation_id
- `applyScenario(bundle, options)` — compile and submit scenario bundle
- `validateScenario(bundle, options)` — dry-run scenario validation
- `mcpInitialize()`, `mcpListTools()`, `mcpCallTool()` — MCP protocol support

## 0.1.1 (2026-03-13)

- Initial alpha release with full AXME API coverage (78 methods)
- SSE streaming, intent lifecycle, inbox, webhooks, admin APIs
- Zero external dependencies (native Node.js fetch)

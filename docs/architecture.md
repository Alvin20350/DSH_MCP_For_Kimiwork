# Architecture and recovery contract

## Components

- `@local/dsh-kimi-bridge` runs inside the existing DeepSeek Harness Desktop profile. It owns the local MCP endpoint and calls Harness Session, Agent, SessionQuery, and Workspace services.
- The Kimi plugin contains a bundled stdio proxy and orchestration instructions. The proxy reads the bridge token from the process or GUI user environment and forwards MCP calls to the loopback HTTP endpoint, so Kimi does not need to inherit the token itself. It does not duplicate DSH session logs or hold the DeepSeek API key.

## Durable identity

A DSH `sessionId` is the execution identity. The bridge stores only a small JSON index containing request-to-session mappings, each canonical workspace's most recently delegated session, consumer event cursors, and schema version. Writes are serialized and use write-temp-then-rename replacement.

A caller should supply a stable `requestId` for every logical submission. A retry with the same ID resolves the existing session before any new session can be created. DSH prompt admission independently deduplicates the same `requestId` in its user message source.

## Reconnection

- DSH remains the source of truth for prompts, responses, tools, turns, and interruption records.
- A bare status/result/watch call can inspect a cold persisted session without starting an Agent.
- Delegation, continuation, messaging, and cancellation explicitly resume the persisted Agent first.
- `ds_continue` resolves the current workspace's last delegated session, or an explicitly supplied session ID. It never silently creates a replacement session.
- A continuation without a prompt only reattaches and reports state. The caller must supply a prompt to start new model work; this prevents a bare reconnect from repeating side effects.
- Watch cursors are durable session event sequence numbers. Live delivery is only an optimization; a read after reconnect replays persisted events.

## Compatibility and security

- MCP protocol version: `kimi-dsh-bridge/v1`.
- The health response reports bridge version, Harness version, capabilities, and whether the Harness build has been tested.
- Only loopback HTTP is supported. MCP requests require a bearer token and a loopback Host header; browser-originated requests require a matching loopback Origin.
- Existing registered workspaces are allowed by default. New workspace roots must be explicitly configured through `allowedRoots`.
- Approval requests are reported but are never answered by the bridge.
- The DeepSeek API key stays in Harness. The bridge token is not the DeepSeek key and grants control only of the local bridge.

## Deliberate limits

- Kimi's native subagent panel is not modified. Live full-fidelity execution remains visible in Harness Desktop; Kimi receives compact status and durable results.
- Transient assistant token frames are not treated as durable history. After reconnection, the bridge returns committed events and status.
- A power failure cannot prove that an external side effect did not happen. Continuation prompts should instruct DSH to inspect the workspace before repeating destructive or irreversible steps.

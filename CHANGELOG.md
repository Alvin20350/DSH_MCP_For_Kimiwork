# Changelog

## 0.1.2

- Replace direct HTTP MCP configuration in Kimi with a bundled stdio proxy.
- Read the bridge token from process, Windows user, or macOS GUI environments so Kimi background processes do not need to inherit it.
- Share the same proxy between Kimi Work and Kimi Code, and add end-to-end stdio forwarding tests.

## 0.1.1

- Create delegated sessions with `workspaceId`, so they appear under the registered Harness workspace instead of “Ungrouped”.
- Add workspace-membership assertions to unit, live recovery, and desktop checks.
- Verify real delegation, same-session recovery, follow-up control, and durable event replay against Harness `0.2.1-rc.3`.

## 0.1.0

- Add the Harness MCP bridge and Kimi Work/Kimi Code integrations.
- Add persistent request/session/workspace bindings, idempotent requests, and durable event cursors.
- Add followup, steering, injection, cancellation, and reconnect-without-prompt semantics.

# Security Policy

## Supported versions

This project is tested against DeepSeek Harness Desktop `0.2.1-rc.3`. Other Harness versions are blocked by default because Harness is still a developer preview.

## Credential model

- DeepSeek API keys belong to Harness and are never required by the Kimi plugin.
- `KIMI_DSH_BRIDGE_TOKEN` is a separate local bridge credential. Do not commit it or print it in logs.
- The MCP endpoint must remain on `127.0.0.1`; do not expose it through a LAN address, public reverse proxy, or tunnel.
- Workspaces are restricted to registered workspaces unless an administrator deliberately configures `allowedRoots`.
- The bridge reports approval requests but never answers them. Users approve high-risk actions in Harness Desktop.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository instead of posting credentials, session logs, or sensitive workspace contents in a public issue. Include the bridge version, Harness version, operating system, reproduction steps, and impact. Redact all secrets and personal paths before sharing logs.

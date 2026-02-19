# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

n8n community node package (`n8n-nodes-certbot`) for managing Let's Encrypt SSL certificates via Certbot with Cloudflare DNS-01 validation. Runs certbot CLI commands through Node.js `child_process.exec()`.

## Build & Lint

```bash
npm run build    # tsc + copies certbot.svg and Certbot.node.json to dist/
npm run lint     # tsc --noEmit (type checking only)
```

The build script uses Unix `cp` — requires Git Bash, WSL, or similar on Windows. No test framework, ESLint, or Prettier is configured. TypeScript strict mode is enabled.

Build output lands in `dist/` mirroring the source layout. The `n8n` key in `package.json` points to `dist/credentials/CloudflareDnsApi.credentials.js` and `dist/nodes/Certbot/Certbot.node.js`. The build step also copies `certbot.svg` and `Certbot.node.json` (codex metadata for n8n UI categories/aliases) into `dist/nodes/Certbot/`.

## Architecture

### n8n Node Package

Two entry points registered in `package.json` under the `n8n` key (n8nNodesApiVersion: 1):

- **Node** (`nodes/Certbot/Certbot.node.ts`): Implements `INodeType` with five operations — Obtain, Renew, Revoke, Delete, List. Each operation is a standalone async handler function (`executeObtain`, `executeRenew`, etc.) called from `execute()`. Output parsing uses regex in `parseObtainOutput()` and `parseCertificatesOutput()` to handle both certbot v4 and v5 output formats.
- **Credential** (`credentials/CloudflareDnsApi.credentials.ts`): Implements `ICredentialType` for Cloudflare auth. An `authMethod` toggle switches between API Token and Global API Key modes using `displayOptions.show`. Credentials are only needed for the Obtain operation (temp `.ini` file written with the matching format).

### Key Patterns

- `execAsync()` — promisified `child_process.exec` with 10MB buffer limit.
- Cloudflare credentials written to a temp `.ini` file (0o600 permissions), cleaned up in `finally`.
- `shellEscape()` wraps values in single quotes to prevent shell injection.
- All operations support a `useSudo` toggle that prepends `sudo`.
- Error handling uses `continueOnFail()` in the item loop.

### Deployment Infrastructure (sibling repo `../n8n2/`)

The n8n instance runs in Docker with Traefik reverse proxy, Postgres, Redis, and a Cloudflare Tunnel for secure M2M webhook access:

- `docker-compose.yml` — Traefik + Postgres + n8n + Redis + n8n-worker + cloudflared
- `Dockerfile` — n8n image with certbot + certbot-dns-cloudflare installed
- `hooks.js` — Azure AD App Proxy header-based SSO middleware
- `.env` — Cloudflare tunnel token, Azure AD OIDC, CF Access Service Token placeholders

Cloudflare Tunnel (`cloudflared` service) provides outbound-only access to n8n webhooks at `cert-api.inlumi.education`, protected by Cloudflare Access Service Tokens for M2M auth.

### Scripts (`scripts/`)

Standalone utilities for certificate management outside n8n. Not part of the npm package build.

| Script | Purpose |
|---|---|
| `manage-certs.ps1` | Windows cert manager: interactive menu, auto-renew, pull-only renewal. Supports AzureAD/CloudflareToken/ApiKey auth |
| `manage-2012-certs.ps1` | Windows Server 2012 R2 variant of manage-certs.ps1 |
| `manage-certs.sh` | Linux equivalent: list, check, request, download, auto-renew, pull-renew commands |
| `install-cert.ps1` | Windows cert installer: PEM→PFX conversion, IIS bindings, RDS configuration |
| `install-cert.sh` | Linux cert installer with service restart |
| `setup-cf-tunnel.ps1` | Automates Cloudflare Tunnel + Access Application creation |
| `deploy-workflows.ps1` | Deploys example workflow JSON files to n8n via API |
| `debug-workflow.js` | Fetches recent failed n8n executions via API |
| `fix-*.js` | One-off n8n workflow patches via API |

### Example Workflows (`examples/`)

Importable n8n workflow JSON files (contain `REPLACE_WITH_CREDENTIAL_ID` placeholders):

- `cert-webhook-endpoints.json` — Four webhook endpoints: `/webhook/cert/{list,check,request,download}` with path traversal validation
- `auto-renewal-schedule.json` — Daily 02:00 schedule trigger that lists certs, filters those expiring within 14 days, and renews them
- `test-certbot-list.json` — Minimal test workflow for List operation

### Certificate Renewal Architecture (Methods 3+4)

Two complementary approaches work together:

1. **Method 3 (Cloudflare Tunnel)**: Scripts call `https://cert-api.inlumi.education/webhook/cert/*` with `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. Cloudflare Access validates the Service Token before forwarding through the tunnel to n8n.

2. **Method 4 (Pull Model)**: n8n auto-renews certs on a daily schedule. Servers check local cert expiry and only download already-renewed certs when needed (pull-renew mode with 7-day threshold).

The PowerShell script's `-ScheduledRenewal` switch triggers full auto-renew (request + download + install + schedule next task). The `-PullOnly` switch triggers download-only mode.

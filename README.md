# n8n-nodes-certbot

Manage [Let's Encrypt](https://letsencrypt.org/) SSL certificates from [n8n](https://n8n.io/) workflows using [Certbot](https://certbot.eff.org/) with Cloudflare DNS-01 validation.

## Prerequisites

The **n8n host machine** must have:

1. **Certbot** installed (`certbot` CLI available in PATH)
2. **certbot-dns-cloudflare** plugin installed
3. The n8n process must have sufficient permissions to run `certbot` (or use the *Use Sudo* option)

```bash
# Example installation (Debian/Ubuntu)
sudo apt install certbot python3-certbot-dns-cloudflare
```

## Installation

### Community Nodes (recommended)

1. Open **Settings > Community Nodes** in n8n
2. Enter `n8n-nodes-certbot`
3. Click **Install**

### Manual

```bash
# From your n8n custom extensions directory
cd ~/.n8n/custom
npm install n8n-nodes-certbot
# Restart n8n
```

## Credential Setup

Create a **Cloudflare DNS API** credential in n8n with one of:

| Method | Fields |
|---|---|
| **API Token** (recommended) | A Cloudflare API Token with `Zone > DNS > Edit` permissions |
| **Global API Key** | Your Cloudflare account email + Global API Key |

The credential is only used by the **Obtain Certificate** operation to write a temporary `cloudflare.ini` file for the certbot-dns-cloudflare plugin.

## Operations

| Operation | Description |
|---|---|
| **Obtain Certificate** | Request a new certificate using Cloudflare DNS-01 validation |
| **Renew Certificate** | Renew a specific certificate by name |
| **Revoke Certificate** | Revoke a certificate (by name or file path) |
| **Delete Certificate** | Delete a certificate from Certbot's local store |
| **List Certificates** | List all certificates managed by Certbot |

### Obtain Certificate

Key parameters:
- **Domains** — comma-separated (e.g. `example.com, *.example.com`)
- **Email** — for Let's Encrypt registration
- **Key Type** — ECDSA (default) or RSA
- **Server** — Production or Staging (use staging for testing)
- **Propagation Seconds** — DNS propagation wait time (default 10)

### Renew Certificate

- **Certificate Name** — name of the cert to renew
- **Dry Run** — simulate without renewing

### Revoke Certificate

- **Revoke By** — identify cert by name or file path
- **Reason** — unspecified, key compromise, affiliation changed, superseded, cessation of operation
- **Delete After Revoke** — remove cert files after revoking

## All Operations

- **Use Sudo** — prepend `sudo` to the certbot command (default: off)

## License

MIT

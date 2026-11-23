# NEWGEN CHAT homeserver (development / self-hosted)

This directory provides a pinned Matrix Synapse + PostgreSQL deployment base. Synapse is the message relay and account/room service; clients perform E2EE. Do not expose port 8008 directly to the public internet.

## First-time setup

1. Install Docker Engine and Docker Compose v2.
2. Copy `.env.example` to `.env`; set a unique long `POSTGRES_PASSWORD` and your permanent `MATRIX_SERVER_NAME`.
3. Generate Synapse configuration (run from this directory):

```bash
mkdir -p data
docker run -it --rm \
  -v "$(pwd)/data:/data" \
  -e SYNAPSE_SERVER_NAME="$(grep '^MATRIX_SERVER_NAME=' .env | cut -d= -f2-)" \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:v1.163.0 generate
```

4. Edit `data/homeserver.yaml` before starting. Configure `database` for PostgreSQL using the `postgres` service, disable public registration (`enable_registration: false`), set `public_baseurl` to your HTTPS URL, and configure a strong `registration_shared_secret` only if you intentionally need controlled account provisioning. Keep all secrets out of Git.
5. Confirm the generated listener only binds to the container interface and does not expose the admin API publicly. Keep host port `8008` bound to `127.0.0.1` as in Compose.
6. Start with `docker compose --env-file .env up -d` and inspect `docker compose logs -f synapse`.

## Production requirements

- A domain you control, HTTPS reverse proxy, firewall, backups, monitoring, update plan and a stable server host are required for internet use.
- Keep Synapse admin endpoints private. Do not commit `.env`, `data/`, signing keys, database dumps, or registration secrets.
- Configure PostgreSQL in `homeserver.yaml` before the first production run; Synapse's generated config defaults to SQLite. Follow the official Synapse PostgreSQL guide before migration.
- This is infrastructure, not a finished public service. No domain, server, account or hosted endpoint is provisioned by this repository.

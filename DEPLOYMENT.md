# Deploying Notionless

Notionless ships as a **desktop (Mac) app** — there is **no hosted web app**. It
is **local-first and pure-P2P**: the only server is a tiny **stateless WebRTC
signaling relay** that brokers peer connections and stores nothing (it sees only
BLAKE2b-hashed room names and E2EE ciphertext). There is **no database, no
accounts, no Stripe** — the old SaaS deploy (Postgres/JWT) is gone.

Public deployment:

| URL | Serves |
| --- | --- |
| `wss://oss.naridon.com/signaling` | the signaling relay (WebSocket) |
| `https://oss.naridon.com/health` | relay liveness check |
| `https://github.com/Naridon-Inc/notionless/releases/latest` | desktop downloads |

The relay runs as a single `backend` container in **one AWS Lightsail container
service** (`notionless`, `eu-central-1`), exposed directly as the service's
public HTTPS endpoint (Lightsail terminates TLS). No nginx, no static site —
`oss.naridon.com/` and any other path returns 404; only `/signaling` and
`/health` respond.

Invite links are `notionless://invite#team=…` deep links: clicking one opens the
installed desktop app and joins the team. Teammates without the app install it
from the download page first, then open the link (or paste the
`notionless-team:…` code into **Join a team**). The secret lives in the URL
`#fragment`, so it never reaches any server.

## One-command deploy

```bash
# Docker running + AWS CLI configured
./scripts/deploy-naridon.sh
```

The script: ensures the `notionless` Lightsail service exists → builds & pushes
the `backend` (relay) image (`linux/amd64`) → deploys it as the public endpoint
→ attaches the `oss.naridon.com` custom domain → upserts the Route53 CNAME.
Re-run any time to ship a new relay build. It's idempotent.

## DNS / TLS (Route53 — already set up)

`naridon.com` is in Route53 (zone `Z03845791SUWSZWYLX4SI`). The TLS cert is a
Lightsail managed certificate (`notionless-oss`, `eu-central-1`).

1. **Cert** — `aws lightsail create-certificate --region eu-central-1
   --certificate-name notionless-oss --domain-name oss.naridon.com` *(done)*.
2. **Validation CNAME** — the cert's `_<hash>.oss.naridon.com` CNAME is in
   Route53 *(done)*; the cert auto-validates once it propagates. Check:
   ```bash
   aws lightsail get-certificates --region eu-central-1 \
     --certificate-name notionless-oss \
     --query 'certificates[0].certificateDetail.status' --output text   # want: ISSUED
   ```
3. **Attach + traffic CNAME** — handled by `deploy-naridon.sh` steps 5–6 once the
   cert is `ISSUED`: it attaches the domain to the service and upserts
   `oss.naridon.com → <service>.cs.amazonlightsail.com`.

## Config knobs

Sensible defaults live in `src/renderer/src/config.js`; override at build time:

| Env var | Default | Purpose |
| --- | --- | --- |
| `VITE_SIGNALING_URL` | `wss://oss.naridon.com/signaling` | the relay (baked into desktop builds) |
| `VITE_APP_DEEP_LINK` | `notionless://invite` | scheme used to build invite/share links |
| `VITE_DOWNLOAD_URL` | `…/Naridon-Inc/notionless/releases/latest` | "no app yet" download target |

`p2p.js` ignores the relay on `localhost`/`127.0.0.1` dev (it uses the local
`:4444` signaling server), so these defaults are safe for development.

## Desktop builds

```bash
pnpm run dist        # electron-builder installers (publishes to the S3 update bucket)
```

The `notionless://` protocol is registered by the app, so invite links hand off
to the desktop app when it's installed.

## Web build (dev-only)

`pnpm run build:web` still exists, but only for local collaboration/sync testing
(run `dist-web/` alongside an Electron instance against the same relay). It is
**not** deployed and is not a product surface.

## Self-hosting

Notionless has no lock-in. Point `VITE_SIGNALING_URL` at any
[`y-webrtc`-compatible](https://github.com/yjs/y-webrtc) signaling relay (or run
`backend/` anywhere with `RELAY_ONLY=true`). The relay never sees note content.

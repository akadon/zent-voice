# Zent Stream

Voice and stage channel service for **Zent** — a self-hosted Discord alternative. Manages voice state, soundboard, and stage channels via LiveKit.

## Quick Start

```bash
npm install
cp .env.example .env  # fill in your values
npm run dev
```

Runs on port 4005 by default. Requires a running LiveKit server and the same MySQL/Redis as [zent-server](https://github.com/akadon/zent-server).

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Fastify 5 |
| Database | MySQL 9.0 (Drizzle ORM) |
| Cache | Redis 7 (ioredis) |
| Voice | LiveKit Server SDK |
| WebSocket | Native `ws` (event dispatch) |
| Validation | Zod |

## Structure

```
src/
  index.ts              Fastify server entry point
  config/               Zod-validated env, Redis connections, app config
  db/                   Drizzle ORM schema and connection pool
  gateway/              WebSocket event dispatch to main gateway
  middleware/            Internal API key auth
  repositories/         Data access (voice state, stage, soundboard)
  routes/               REST endpoints
    voice.ts            Join/leave, mute/deafen, move users
    stage.ts            Stage instances, speakers, requests
    soundboard.ts       Guild soundboard management
  services/             Business logic (voice state, stage, soundboard)
  utils/                Snowflake IDs, Redis dispatch helpers
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MySQL connection string (`mysql://...`) |
| `REDIS_URL` | No | Redis URL (default: `redis://localhost:6379`) |
| `AUTH_SECRET` | Yes | Shared secret for JWT verification (min 16 chars) |
| `LIVEKIT_URL` | No | LiveKit server URL (default: `ws://localhost:7880`) |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `INTERNAL_API_KEY` | Yes | Key for internal service-to-service auth |
| `VOICE_PORT` | No | Server port (default: 4005) |
| `CORS_ORIGIN` | No | Allowed origin (default: `http://localhost:3000`) |

## Deployment

Deployed as a Kubernetes pod on **Oracle Cloud Always Free** infrastructure. Traffic routed through Cloudflare (Free plan) and OCI load balancers — not directly internet-facing. CI/CD via self-hosted GitHub Actions runner.

> All secrets must be provided via environment variables — never committed to source.

## License

Private. All rights reserved.

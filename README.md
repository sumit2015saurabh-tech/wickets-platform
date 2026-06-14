# 22yards Platform — Microservices Backend

16 services + API Gateway with **WebSocket live odds** (1s updates vs 20wickets' 20s polling).

## Live demo frontend

**https://sumit2015saurabh-tech.github.io/22yards/**

## Quick start

```bash
cp .env.example .env
docker compose up -d --build
node scripts/seed-all.js
```

API Gateway: `http://localhost:8080`  
WebSocket odds: `ws://localhost:8080/ws/odds`

## Architecture

| Service | Port | Role |
|---------|------|------|
| api-gateway | 8080 | JWT proxy + **WebSocket odds broadcast** |
| auth-service | 3001 | Users, JWT |
| wallet-service | 3002 | Points ledger, admin deposits |
| catalog-service | 3003 | Sports, fixtures |
| odds-service | 3004 | Markets, **1s odds tick** |
| sportsbook-service | 3005 | Bet placement |
| casino-service | 3007 | 50+ casino games seeded |
| ... | | KYC, CMS, compliance, etc. |

## Odds latency

- **20wickets**: polls REST APIs every ~20 seconds (exploitable lag)
- **22yards**: odds-service ticks every 1s, gateway pushes via WebSocket to all clients

Connect frontend locally:

```bash
cd ../22yards
VITE_API_URL=http://localhost:8080/api VITE_WS_URL=ws://localhost:8080/ws/odds npm run dev
```

## Demo logins (frontend demo mode)

- Player: `demo` / `demo123`
- Admin: `admin` / `admin123`

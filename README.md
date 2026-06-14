# Wickets Platform — Microservices Architecture

True microservices: **16 independent services**, each with its own database, communicating via **REST** (sync) and **RabbitMQ** (async events). **No payment gateway** — admin-managed points only.

## Architecture

```
                    ┌─────────────────┐
                    │   API Gateway   │  :8080
                    │  JWT + routing  │
                    └────────┬────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
┌────▼────┐  ┌────▼────┐  ┌───▼───┐  ┌────▼────┐  ┌──▼───┐
│  auth   │  │ wallet  │  │catalog│  │  odds   │  │ ...  │
│  :3001  │  │  :3002  │  │ :3003 │  │  :3004  │  │      │
│ auth_db │  │wallet_db│  │cat_db │  │ odds_db │  │      │
└────┬────┘  └────┬────┘  └───────┘  └─────────┘  └──────┘
     │            │
     └────────────┼──────────────────────────────┐
                  │         RabbitMQ             │
                  └──────────┬───────────────────┘
                             │
                    ┌────────▼────────┐
                    │  notification   │
                    │  wallet events  │
                    └─────────────────┘
```

## Services

| Service | Port | Database | Responsibility |
|---------|------|----------|----------------|
| api-gateway | 8080 | — | JWT, routing, CORS |
| auth-service | 3001 | auth_db | Users, login, JWT |
| wallet-service | 3002 | wallet_db | Points, deposits, withdrawals |
| catalog-service | 3003 | catalog_db | Sports, fixtures, teams |
| odds-service | 3004 | odds_db | Markets, odds |
| sportsbook-service | 3005 | sportsbook_db | Bet placement |
| settlement-service | 3006 | — | Orchestrates settlement |
| casino-service | 3007 | casino_db | Casino games/sessions |
| promotions-service | 3008 | promotions_db | Bonuses, codes |
| notification-service | 3009 | notification_db | Event-driven alerts |
| kyc-service | 3010 | kyc_db | KYC submissions |
| cms-service | 3011 | cms_db | Content/banners |
| support-service | 3012 | support_db | Support tickets |
| compliance-service | 3013 | compliance_db | Limits, self-exclusion |
| live-service | 3014 | live_db | Live match events |
| file-service | 3015 | — | Admin file uploads |

## Prerequisites

Install these tools:

1. **Docker Desktop** — https://docs.docker.com/get-docker/
2. **Node.js 20+** — for local dev/build
3. **Git**

## Quick start (Docker — recommended)

```bash
cd ~/Projects/wickets-platform

cp .env.example .env
# Edit JWT secrets in .env before production

# Generate Dockerfiles
node scripts/generate-all-dockerfiles.js

# Build and start entire stack (~2-3 min first time)
docker compose up -d --build

# Wait for postgres healthy, then seed
sleep 15
node scripts/seed-all.js

# Verify
curl http://localhost:8080/health
curl http://localhost:8080/api/catalog/sports
```

**API entry point:** `http://localhost:8080`  
**RabbitMQ UI:** `http://localhost:15672` (user: `wickets`, pass: `wickets_secret`)

### Default admin
- Username: `admin`
- Password: `ChangeMeAdmin123!` (from `.env`)

```bash
# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMeAdmin123!"}'
```

## Local development (without Docker)

```bash
# Start infrastructure only
docker compose up -d postgres rabbitmq redis

# Install all packages
npm install
cd packages/shared && npm install && npm run build && cd ../..
cd packages/service-common && npm install && npm run build && cd ../..

# For each service:
cd services/auth-service
npm install
npx prisma db push
npm run build && npm start
```

## API routes (via gateway)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/register` | Public |
| POST | `/api/auth/login` | Public |
| GET | `/api/users/me` | User |
| GET | `/api/wallet/balance` | User |
| POST | `/api/wallet/admin/users/:id/deposit` | Admin |
| GET | `/api/catalog/fixtures` | Public |
| POST | `/api/sportsbook/bets` | User |
| POST | `/api/settlement/admin/markets/:id/settle` | Admin |
| GET | `/api/casino/games` | Public |
| POST | `/api/promotions/redeem` | User |

Full list in each service's `src/index.ts`.

## Event bus (RabbitMQ)

| Event | Publisher | Subscribers |
|-------|-----------|-------------|
| `user.registered` | auth | wallet (create wallet) |
| `wallet.withdrawal.requested` | wallet | wallet (admin notification) |
| `bet.placed` | sportsbook | — |
| `bet.settled` | sportsbook | notification |
| `kyc.submitted` | kyc | notification |
| `support.ticket.created` | support | notification |

## Security

- JWT validated at **API Gateway only**
- User context passed to services via `x-user-id`, `x-user-role` headers (internal network)
- Service-to-service calls require `x-service-api-key`
- Argon2id passwords, refresh token rotation, account lockout
- **No payment gateway** — zero PCI scope

## Production checklist

- [ ] Change `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SERVICE_API_KEY`
- [ ] Change admin password
- [ ] Use Kubernetes or Docker Swarm for orchestration
- [ ] Separate managed PostgreSQL per service
- [ ] Managed RabbitMQ (CloudAMQP / Amazon MQ)
- [ ] mTLS between services
- [ ] Centralized logging (ELK/Datadog)

## Commands

```bash
docker compose up -d --build    # Start all services
docker compose logs -f api-gateway
docker compose down -v          # Stop and remove volumes
node scripts/seed-all.js        # Seed sample data
```

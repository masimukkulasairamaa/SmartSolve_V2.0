# Jharkhand Innovation & Problem Solving Platform — Phase 10

Final cumulative, deployment-ready release for the Government of Jharkhand, Department of Higher & Technical Education.

## Product flow

```text
Citizen
  ↓
Challenge + evidence + location
  ↓
AI analysis + translation
  ↓
Category + request type + expertise
  ↓
Nearest eligible colleges/universities + relevant industry partners
  ↓
Organization adoption
  ↓
Student/faculty/industry collaboration
  ↓
Project milestones + deliverables
  ↓
Solution proposal + review + testing + validation
  ↓
Trusted rating
  ↓
Government monitoring + moderation + impact analytics
```

## Phase 10 production hardening

- Multi-stage Docker builds for API and frontend
- Nginx production SPA serving and `/api` reverse proxy
- PostgreSQL health/readiness checks
- Migration tracking in `schema_migrations`; migrations are applied once in order
- Graceful API shutdown and connection-pool cleanup
- Strict production environment validation
- Helmet security headers, restricted CORS and request IDs
- In-process API and authentication rate limits
- JSON/form request-size limits
- File upload limits and allow-listed MIME types
- Persistent local storage volume or optional S3-compatible object storage
- Administrative audit trail
- Production deployment documentation
- Release-structure validation script
- No demo seed by default

## Production deployment

### 1. Prepare the host

Install Docker Engine and Docker Compose v2.

### 2. Create the environment file

Copy `.env.example` to `.env` and replace every required placeholder. In particular:

- `POSTGRES_PASSWORD`
- `JWT_SECRET` (32+ random characters)
- `CLIENT_URL` (the public HTTPS origin)

For object storage, set `STORAGE_PROVIDER=s3` and configure the S3-compatible credentials/bucket.

### 3. Build and start

```bash
docker compose build --pull
docker compose up -d
```

The `migrate` service runs database migrations before the API starts. The frontend is exposed on `HTTP_PORT` (default 5173).

### 4. Verify

```bash
docker compose ps
curl http://localhost:5173/healthz
curl http://localhost:5173/api/health/
```

The API readiness endpoint is:

```text
/api/health/ready
```

### 5. Put HTTPS in front

For a public deployment, terminate TLS at a managed load balancer/reverse proxy or at an edge proxy in front of this stack. Set `CLIENT_URL` to the exact public HTTPS origin and keep `TRUST_PROXY=true` when the API is behind a trusted reverse proxy.

## Local development

```bash
npm install
cd client && npm install
cd ../server && npm install
cd ..
```

Start PostgreSQL, then:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Frontend: `http://localhost:5173`.

## Demo data

Demo seed is disabled by default. Never enable `DEMO_SEED=true` for a production environment.

## Environment variables

See `.env.example`. Secrets must be supplied by the deployment secret manager/environment and must never be committed.

## Validation

Release structure validation:

```bash
npm test
```

If dependencies are installed, build both applications:

```bash
npm run build
```

The final release should be deployed only after `npm test`, `npm run build`, database migration, and a smoke check of `/api/health/ready` succeed in the target environment.

## Operational notes

- Back up PostgreSQL before upgrades and retain tested restore procedures.
- The local upload provider requires a persistent Docker volume or equivalent durable disk.
- S3-compatible storage is recommended for multi-instance production deployments.
- Rotate `JWT_SECRET`, database credentials and object-storage credentials through the deployment secret manager according to organizational policy.
- Monitor API 4xx/5xx rates, database availability, disk/object-storage usage and container health.
- Do not expose PostgreSQL publicly.

## SmartSolve interface release

The deployment release includes the redesigned SmartSolve interface:

- Live Issue Feed as the primary workspace with a large Jharkhand-style issue map, urgency pins and latest public reports.
- Touch-friendly public issue reporting with District, Block, Location / landmark and an `Attach Geo-tagged Photo/Video` evidence area.
- Browser geolocation is captured privately in the background for routing; users do not enter or see latitude/longitude fields.
- AI opportunity desk for colleges, universities and companies. After submission, the AI-derived problem category, expertise and recommended work types are compared with each institution's declared accepted problem areas, expertise and accepted request types to produce an explainable fit score.
- Government command center with a ticket queue and a visual lifecycle progression from Reported through Resolution.
- Existing collaboration, project lifecycle, communication, translation, SOS, moderation, ratings, audit and production hardening remain in the same cumulative codebase.
- Database migration `012_challenge_location.sql` adds the human-facing Block field without removing the existing private coordinates used by routing.

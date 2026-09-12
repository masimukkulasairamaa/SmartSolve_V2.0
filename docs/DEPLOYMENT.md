# Production deployment runbook

## Before deployment

1. Create a production `.env` from `.env.example`.
2. Generate a strong unique `JWT_SECRET` (32+ characters; preferably 64+ random bytes).
3. Generate a strong PostgreSQL password.
4. Set the exact public `CLIENT_URL`.
5. Decide between `STORAGE_PROVIDER=local` with durable storage or `STORAGE_PROVIDER=s3`.
6. Configure AI/translation providers only if they are required.
7. Keep `DEMO_SEED=false`.
8. Put HTTPS/TLS at the public edge.
9. Restrict firewall access so PostgreSQL is internal only.

## Deployment

```bash
docker compose build --pull
docker compose up -d
```

The migration job is a one-shot dependency of the API. If a migration fails, the API does not start.

## Verification

```bash
docker compose ps
curl -f http://localhost:5173/healthz
curl -f http://localhost:5173/api/health/
curl -f http://localhost:5173/api/health/ready
```

Then exercise:

- citizen login
- challenge creation
- AI analysis/fallback
- organization matching
- student volunteer flow
- project messaging
- solution lifecycle
- rating after interaction
- government dashboard
- moderation
- SOS activation in a controlled test environment

## Upgrade procedure

```bash
docker compose pull
docker compose build --pull
docker compose up -d
```

Always back up PostgreSQL before a schema-changing release.

## Rollback

Application containers can be rolled back to the previous image/tag. Database rollback must use a tested database backup/restore procedure; destructive reverse migrations are intentionally not automated.

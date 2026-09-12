# Release validation

## Static release validation

```bash
npm test
```

This checks required release files and ensures forbidden local build/secrets directories are not included.

## Build validation

Install dependencies and run:

```bash
npm run build
```

## Container validation

```bash
docker compose build --pull
docker compose up -d
docker compose ps
curl -f http://localhost:5173/healthz
curl -f http://localhost:5173/api/health/ready
```

## Functional smoke test

Use the supplied demo accounts only in a non-production environment. Verify the complete workflow from challenge submission through government impact monitoring.

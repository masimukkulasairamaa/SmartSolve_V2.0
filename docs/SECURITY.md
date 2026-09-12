# Security controls

- JWT access tokens are short-lived and refresh tokens are hashed in PostgreSQL.
- Production refuses the development JWT secret.
- Authentication endpoints have a stricter rate limit.
- All API endpoints are behind a general request rate limit.
- CORS accepts only configured origins.
- Helmet supplies HTTP security headers.
- Request IDs make server-side diagnostics traceable.
- JSON/form bodies and file uploads have bounded sizes.
- Upload MIME types are allow-listed.
- Private citizen contact details are disclosed only after explicit approval.
- Government moderation and organization governance actions are written to `audit_logs`.
- PostgreSQL is not published by the production Compose stack.
- Secrets are environment/deployment inputs, not repository files.
- Production uploads can use S3-compatible object storage to avoid local-disk coupling.

## Additional production recommendations

Use a managed TLS/WAF/rate-limiting edge, centralized logs, database encryption/managed PostgreSQL where available, regular dependency updates, secret rotation, vulnerability scanning and tested backups.

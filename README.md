# Even OS

> Hospital Operating System by Even Healthcare. Replaces KareXpert across 6 hospitals.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **API:** tRPC (type-safe RPC)
- **Database:** PostgreSQL via Drizzle ORM (Neon for dev, Azure for production)
- **Auth:** JWT HS256 with cookie-based sessions
- **Styling:** Tailwind CSS + Shadcn/ui
- **Monorepo:** Turborepo + pnpm workspaces

## Quick Start

```bash
pnpm install
cp .env.example .env.local  # Fill in DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
pnpm db:push               # Apply schema
pnpm db:seed               # Seed hospital + admin user
pnpm dev                   # http://localhost:3000
```

**Login:** admin@even.in / EvenOS2026! (must change on first login)

## Project Structure

```
even-os/
├── apps/web/          # Next.js hospital application
├── packages/db/       # Drizzle client + connection
├── packages/config/   # Shared Zod config schema
├── packages/types/    # Shared TypeScript types
└── packages/ui/       # Shared UI components
```

## Sprint Status

- [x] S0 — Scaffolding (monorepo, DB, auth skeleton, health check)
- [ ] S1 — Foundations (full auth, RBAC, user management)
- [ ] S2 — Master Data
- [ ] S3 — Patient Registry
- [ ] S4–S13 — See BUILD-PLAYBOOK.md

## API Routes

### Health Check

```bash
GET /api/health
```

Returns database connectivity, uptime, and version.

### tRPC Routes

All tRPC routes available at `/api/trpc/[procedure]`:

**Auth:**
- `auth.login` (POST) - Login with email/password
- `auth.logout` (POST) - Destroy session
- `auth.me` (GET) - Get current user
- `auth.changePassword` (POST) - Change password

## Database

Uses Neon PostgreSQL (serverless HTTP driver). Schema includes:

- **Foundations:** hospitals, users, sessions, roles, permissions
- **Audit:** audit_log (append-only), event_log (FHIR versioning)
- **Operational:** login_attempts, push_subscriptions, error_log, config_entities

All tables use UUID primary keys and include `created_at` / `updated_at` timestamps.

## License

Proprietary — Even Healthcare Pvt. Ltd.

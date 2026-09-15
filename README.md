# SimplyCRM

A shared, small-team contact-management CRM. See [SPEC.md](./SPEC.md) for the full data model, screens, and scope.

## Stack

- `server/` — Node.js + Express + TypeScript API, PostgreSQL via Prisma
- `client/` — React + TypeScript SPA (Vite), React Router

## Getting started

Requires Node 20+ and a PostgreSQL database.

```bash
npm install                       # installs both workspaces

cp server/.env.example server/.env  # set DATABASE_URL / JWT_SECRET
cp client/.env.example client/.env

npm run --workspace server prisma:migrate   # create tables
npm run --workspace server prisma:seed      # seed admin@example.com / changeme123

npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

## Scripts (root)

- `npm run dev:server` / `npm run dev:client` — run each app in dev mode
- `npm run build` — type-check and build both workspaces
- `npm run typecheck` — type-check both workspaces without emitting

## Status

This is an early scaffold: auth, data model, and routing are wired end-to-end, but several screens (CSV import mapping, custom field management, password change) are stubs. See `SPEC.md` for what's planned.

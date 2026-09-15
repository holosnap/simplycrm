# CLAUDE.md

Guidance for working in this repo. Read [SPEC.md](./SPEC.md) first for product scope; this file covers structure and conventions.

## Structure

npm workspaces monorepo:

```
server/                  Express + TypeScript API
  prisma/schema.prisma   Data model (source of truth for the DB)
  prisma/migrations/     Generated migrations — never hand-edit
  prisma/seed.ts         Fake-data seed script (faker)
  src/lib/               prisma client singleton, env loader
  src/middleware/auth.ts requireAuth / requireAdmin
  src/routes/*.ts        One router per resource
  src/index.ts           App wiring: middleware + route mounting

client/                  React + TypeScript SPA (Vite)
  src/lib/api.ts         Fetch wrapper (adds auth header, throws ApiError)
  src/context/           AuthContext (JWT in localStorage)
  src/components/        Shared UI (Layout/nav)
  src/pages/             One file per screen, routed in src/App.tsx
```

Root `package.json` only has cross-workspace scripts (`dev:server`, `dev:client`, `build`, `typecheck`) — don't add app code at the root.

## Prisma schema conventions

- IDs are `String @id @default(uuid())`.
- Model fields are camelCase; every multi-word column gets `@map("snake_case")`, and every model gets `@@map("snake_case_plural")`. Keep this pairing consistent for new models/fields — don't let Prisma default to camelCase column names.
- Optional foreign keys use `onDelete: SetNull` (e.g. `Contact.companyId`, `Deal.ownerId`) so deleting a Company/User doesn't cascade-delete unrelated records. Only genuinely dependent child rows (e.g. `ContactTag`, `Activity.contact`) use `onDelete: Cascade`, and reference data that must not vanish silently (e.g. `Activity.author`) uses `onDelete: Restrict`.
- When a model has two relations to the same target model, name them explicitly (see `Contact.owner` / `Deal.owner` both using `@relation("...Owner")` back to `User`).
- Enums use lowercase snake_case values (`closed_won`, not `ClosedWon`) since they're stored as Postgres enum labels.
- Money fields are `Decimal @db.Decimal(12, 2)`, not `Float`.
- After editing the schema: `npx prisma format`, then `npx prisma migrate dev --name <description>` from `server/`. Never edit a generated migration file after it's been applied; add a new migration instead.

## Server (Express) conventions

- Every resource gets its own `Router` in `src/routes/<resource>.ts`, imported and mounted in `src/index.ts`. Auth is applied at the mount point (`app.use("/api/x", requireAuth, xRouter)`), not inside individual route handlers — `requireAdmin` is added the same way for admin-only resources (see `/api/users`).
- Validate request bodies with a Zod schema and `safeParse`; on failure return `res.status(400).json({ error: parsed.error.flatten() })`. Reuse the same base schema with `.partial()` for PATCH.
- Always import the shared Prisma client from `src/lib/prisma.ts` — never instantiate `new PrismaClient()` elsewhere.
- Route handlers return the resource wrapped in a named key (`{ contact }`, `{ contacts }`, `{ deal }`), not bare arrays/objects, so the client can add metadata (pagination, etc.) later without a breaking shape change.

## Client (React) conventions

- One component per file in `src/pages/`, named `<Thing>Page.tsx`; register its route in `src/App.tsx`. List pages fetch on mount with `useEffect`; detail pages take the id from `useParams`.
- All API calls go through `src/lib/api.ts` (`api.get/post/patch/delete`) — don't call `fetch` directly from components.
- Auth state lives in `AuthContext` (`useAuth()`), backed by a JWT in `localStorage`. Any route under the authenticated `Layout` assumes `useAuth().user` is non-null (the `Layout` itself redirects to `/login` otherwise).
- Styling is a handful of global classes in `src/index.css` (`.page-header`, `.record-form`, `.hint`, etc.) — no CSS-in-JS or per-component stylesheets yet.

## Scripts

Root: `npm run dev:server` / `dev:client`, `npm run build`, `npm run typecheck`.

Server (`cd server`): `npm run prisma:generate`, `npm run prisma:migrate` (dev migration), `npm run prisma:seed`.

`npm run typecheck` in `server/` type-checks both `src/` and `prisma/` (see `tsconfig.typecheck.json`) — the seed script is real code and should stay type-safe even though it isn't part of the production build.

## Environment

Each workspace has a `.env.example`; copy to `.env` locally (`.env` is gitignored, never commit it). Server needs a running Postgres reachable at `DATABASE_URL`. Seeded login: `admin@example.com` / `changeme123` (plus a few `@example.com` team users — see `prisma/seed.ts`).

## Adding a new entity — checklist

1. Add the model to `prisma/schema.prisma` following the conventions above; run `prisma format` + `prisma migrate dev --name <name>`.
2. Add a router in `server/src/routes/`, mount it in `server/src/index.ts`.
3. Add fake records for it to `prisma/seed.ts` if it's core CRM data.
4. Add client page(s) in `client/src/pages/` and route them in `client/src/App.tsx`.
5. Run `npm run typecheck` and `npm run build` from the repo root before considering the change done.
6. If the change affects product scope (new screens, new out-of-scope items becoming in-scope, etc.), update `SPEC.md` to match — it should stay the accurate description of what's built, not just the original plan.

## Verification

Before treating a change as finished: `npm run typecheck` and `npm run build` from the repo root must both pass. For schema changes, actually run the migration against a real Postgres and re-run the seed script rather than just eyeballing the `.prisma` file.

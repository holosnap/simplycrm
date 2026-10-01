# CLAUDE.md

Guidance for working in this repo. Read [SPEC.md](./SPEC.md) first for product scope; this file covers structure and conventions.

## Structure

npm workspaces monorepo:

```
server/                  Express + TypeScript API
  prisma/schema.prisma   Data model (source of truth for the DB)
  prisma/migrations/     Generated migrations — never hand-edit
  prisma/seed.ts         Fake-data seed script (faker)
  aws/                   IAM policy templates for the app's own runtime credentials
  scripts/               One-off operator scripts (e.g. ses-setup.ts) — run manually
                          with the operator's own AWS credentials, not app code
  src/lib/               prisma client singleton, env loader, AWS SDK clients, email send/queue/retry
  src/middleware/auth.ts requireAuth / requireAdmin
  src/routes/*.ts        One router per resource
  src/types/             Ambient .d.ts for packages whose types our
                          moduleResolution can't otherwise find (see below)
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
- **Never `include: true` a `User` relation** (`owner`, `assignee`, `author`, etc.) — the full row includes `passwordHash`. Always `include: { owner: { select: publicUserSelect } }` using the shared select from `src/lib/publicUser.ts`.

## AWS credentials (SES, etc.)

- **Never read, log, or store an AWS access key in our own code or the database.** AWS SDK clients (see `src/lib/ses.ts`) are constructed with no `credentials` option — the SDK's default provider chain resolves them on its own (env vars locally, an IAM role automatically in deployment). If you find yourself writing code that reads `AWS_ACCESS_KEY_ID` directly, stop — that almost always means you're about to pass it somewhere it shouldn't go.
- **Two different privilege levels, never mixed.** The app's *runtime* IAM policy (`server/aws/*.json`) is scoped as narrowly as possible — e.g. SES is just `ses:SendEmail`/`ses:SendRawEmail` on one identity plus two scoped read-only health-check calls (see `SETUP.md`). *Provisioning* actions (verifying a domain, creating a configuration set, changing account-level settings) live in `server/scripts/` instead, run manually by a human operator with their own, broader AWS credentials — never granted to the deployed app. Adding a new AWS-touching feature means asking which bucket each new permission belongs in, not just adding it to whichever policy is closest at hand.
- Provisioning scripts in `server/scripts/` should be idempotent (safe to re-run) and should converge to the desired state rather than silently no-op when a resource already exists in a different configuration — see `ses-setup.ts` for the create-or-update pattern.

## Email sending

- **Never send inline from a request handler.** Compose/reply routes (`src/routes/emailThreads.ts`) only ever create an `EmailMessage` row with `status: "queued"` and return — the actual SES call happens later, in `src/lib/emailQueue.ts`'s poller. If you add a new way to trigger an email, it goes through the same queue, not a direct `sesClient.send(...)` in the route.
- The queue is an in-process `setInterval` poller reading `EmailMessage` rows from Postgres, not a real job-queue library or SQS — deliberate for this app's current scale (single process, modest volume); see EMAIL_SPEC.md §4a for the tradeoff and what would need to change to run multiple app instances safely.
- A message stuck in `status: "sending"` at server startup means the process died mid-call to SES — the startup sweep in `emailQueue.ts` marks these `failed` rather than retrying them, since retrying risks a duplicate send if SES actually accepted it before the crash. Don't "fix" this by auto-resuming interrupted sends.
- Retry classification lives in `src/lib/emailRetry.ts`: only `MessageRejected` and `AccountSuspendedException` are permanent; everything else retries with full-jitter exponential backoff up to a fixed attempt cap. Add a new permanent error name there, not as a one-off check elsewhere.
- Send pacing comes from `src/lib/sesQuota.ts` (SES's actual `GetAccount().SendQuota.MaxSendRate`, cached), never a hardcoded rate.
- `lastError` on `EmailMessage` is surfaced in the UI whenever it's set, including mid-retry while `status` is still `queued` — not only once a message reaches terminal `failed`. A send failing silently is treated as a bug.
- `EmailThread`/`EmailMessage` are built; `EmailEvent` (and the SNS event-ingestion pipeline that would populate it) is not — see EMAIL_SPEC.md's status line before assuming `status` ever reaches `delivered`/`bounced`/`complained` today.

## Client (React) conventions

- One component per file in `src/pages/`, named `<Thing>Page.tsx`; register its route in `src/App.tsx`. List pages fetch on mount with `useEffect`; detail pages take the id from `useParams`.
- All API calls go through `src/lib/api.ts` (`api.get/post/patch/delete`) — don't call `fetch` directly from components.
- Auth state lives in `AuthContext` (`useAuth()`), backed by a JWT in `localStorage`. Any route under the authenticated `Layout` assumes `useAuth().user` is non-null (the `Layout` itself redirects to `/login` otherwise).
- Styling is a handful of global classes in `src/index.css` (`.page-header`, `.record-form`, `.hint`, etc.) — no CSS-in-JS or per-component stylesheets yet.

## Scripts

Root: `npm run dev:server` / `dev:client`, `npm run build`, `npm run typecheck`.

Server (`cd server`): `npm run prisma:generate`, `npm run prisma:migrate` (dev migration), `npm run prisma:seed`, `npm run ses:setup` (one-time SES provisioning, see `SETUP.md`).

`npm run typecheck` in `server/` type-checks `src/`, `prisma/`, and `scripts/` (see `tsconfig.typecheck.json`) — scripts are real code and should stay type-safe even though they aren't part of the production build.

## Environment

Each workspace has a `.env.example`; copy to `.env` locally (`.env` is gitignored, never commit it). Server needs a running Postgres reachable at `DATABASE_URL`. Seeded login: `admin@example.com` / `changeme123` (plus a few `@example.com` team users — see `prisma/seed.ts`). Email (AWS SES) is optional and unset by default — see `SETUP.md` to provision it; the app boots fine without it, with the email health check reporting "not configured."

## Adding a new entity — checklist

1. Add the model to `prisma/schema.prisma` following the conventions above; run `prisma format` + `prisma migrate dev --name <name>`.
2. Add a router in `server/src/routes/`, mount it in `server/src/index.ts`.
3. Add fake records for it to `prisma/seed.ts` if it's core CRM data.
4. Add client page(s) in `client/src/pages/` and route them in `client/src/App.tsx`.
5. Run `npm run typecheck` and `npm run build` from the repo root before considering the change done.
6. If the change affects product scope (new screens, new out-of-scope items becoming in-scope, etc.), update `SPEC.md` to match — it should stay the accurate description of what's built, not just the original plan.

## Verification

Before treating a change as finished: `npm run typecheck` and `npm run build` from the repo root must both pass. For schema changes, actually run the migration against a real Postgres and re-run the seed script rather than just eyeballing the `.prisma` file.

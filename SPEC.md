# SimplyCRM — Spec (v1)

A lightweight, shared CRM for a small team (2–20 users): contacts, companies, a simple sales pipeline (deals), activity history, tasks, and light organization (tags/custom fields), plus admin/user roles.

## 1. Scope

**In scope (v1):**
- Contacts and the companies/organizations they belong to
- Deals (sales opportunities) moving through pipeline stages, linked to a contact/company
- Notes & activity timeline per contact and per deal (calls, emails, meetings, freeform notes)
- Tasks/reminders tied to a contact
- Tags and simple custom fields on contacts
- CSV import/export
- Team accounts with Admin vs regular User roles
- Shared data pool — all team members see/edit all contacts
- Search and filtering across contacts

**Out of scope (v1):**
- Deal forecasting/reporting (pipeline value totals, win-rate analytics)
- Email/calendar integration (sending mail, calendar sync)
- Multi-tenant SaaS (multiple separate organizations) — single team/org per deployment
- Reporting/analytics dashboards
- Mobile app (responsive web only)

**Assumed scale:** hundreds to low thousands of contacts, single small-business team. Design for correctness and simplicity, not high-volume performance.

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + TypeScript (Vite) | SPA, fetches REST API |
| Backend | Node.js + Express (TypeScript) | REST JSON API |
| Database | PostgreSQL | Relational fit for contacts/companies/deals/tags/tasks |
| ORM | Prisma | Migrations + type-safe queries |
| Auth | Session or JWT-based email/password auth (e.g. `bcrypt` + signed JWT cookies) | No third-party SSO in v1 |
| Hosting | Cloud-hosted: frontend on Vercel (or Render static), backend + Postgres on Render (or Railway/AWS RDS) | Single environment (prod); no multi-tenant infra needed |
| File storage | Not needed in v1 (no attachments) | Revisit if attachments added later |

Rationale: this stack is simple to build, deploy, and staff for a small internal tool, with a straightforward path to add features (pipeline, integrations) later without a rewrite.

## 3. Data Model

### User
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| email | string | unique |
| password_hash | string | bcrypt |
| name | string | |
| role | enum(`admin`, `user`) | admin manages users/settings; user manages contacts |
| created_at | timestamp | |
| last_login_at | timestamp | nullable |

### Company
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | string | |
| domain | string | nullable, e.g. website |
| notes | text | nullable |
| created_at / updated_at | timestamp | |

### Contact
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| first_name | string | |
| last_name | string | |
| email | string | nullable |
| phone | string | nullable |
| title | string | nullable, job title |
| company_id | UUID | FK → Company, nullable |
| owner_id | UUID | FK → User, "primary owner" for accountability (data itself is shared/visible to all) |
| created_at / updated_at | timestamp | |

### Deal
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| title | string | e.g. "Acme Corp — Annual Contract" |
| amount | decimal | deal value |
| stage | enum(`prospecting`, `qualification`, `proposal`, `negotiation`, `closed_won`, `closed_lost`) | |
| company_id | UUID | FK → Company, nullable |
| contact_id | UUID | FK → Contact, nullable |
| owner_id | UUID | FK → User, nullable |
| expected_close_date | timestamp | nullable |
| closed_at | timestamp | nullable, set when stage becomes closed_won/closed_lost |
| created_at / updated_at | timestamp | |

### Tag
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | string | unique |

### ContactTag (join table)
| Field | Type | Notes |
|---|---|---|
| contact_id | UUID | FK → Contact |
| tag_id | UUID | FK → Tag |

### CustomFieldDefinition
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | string | e.g. "LinkedIn URL" |
| field_type | enum(`text`, `number`, `date`, `boolean`) | |
| applies_to | enum(`contact`, `company`) | |

### CustomFieldValue
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| field_id | UUID | FK → CustomFieldDefinition |
| record_id | UUID | id of Contact or Company |
| value | string | stored as string, cast per `field_type` |

### Activity (notes & activity timeline)
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| contact_id | UUID | FK → Contact |
| deal_id | UUID | FK → Deal, nullable — set when the activity is logged against a deal |
| author_id | UUID | FK → User |
| type | enum(`note`, `call`, `email`, `meeting`) | |
| body | text | |
| occurred_at | timestamp | defaults to creation time, editable |
| created_at | timestamp | |

### Task
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| contact_id | UUID | FK → Contact, nullable (task can be general) |
| assignee_id | UUID | FK → User |
| title | string | |
| description | text | nullable |
| due_at | timestamp | nullable |
| status | enum(`open`, `done`) | |
| created_at / completed_at | timestamp | |

## 4. Screens

1. **Login** — email/password.
2. **Contacts List** — searchable/filterable (by tag, company, owner), sortable table, pagination; row click → Contact Detail; bulk CSV import/export actions.
3. **Contact Detail** — contact fields (editable), associated company, tags, custom fields, activity timeline (add note/call/email/meeting entry), open tasks for this contact (add/complete), associated deals.
4. **Companies List** — searchable list of companies with contact counts; click → Company Detail.
5. **Company Detail** — company fields, list of associated contacts and deals.
6. **Deals / Pipeline** — deals grouped or filterable by stage, with amount and owner; click → Deal Detail.
7. **Deal Detail** — deal fields (editable), linked contact/company, activity timeline.
8. **Tasks** — cross-contact list of the current user's (and, for admins, all) open/completed tasks, filterable by due date/status.
9. **Contact/Company/Deal Create & Edit forms** — modal or dedicated page.
10. **CSV Import** — upload, column-mapping step, preview, confirm.
11. **Admin: User Management** (admin-only) — list users, invite/create user, change role, deactivate user.
12. **Admin: Tags & Custom Fields** (admin-only) — manage tag list and custom field definitions.
13. **My Account** — change own name/password.

## 5. Roles & Permissions

- **User**: full CRUD on contacts, companies, deals, tags (assign existing), activity entries, tasks. Cannot manage other users or custom field/tag definitions.
- **Admin**: everything a User can do, plus manage users (create/deactivate/change role), manage tag and custom-field definitions.
- All contact/company/activity data is visible and editable by every authenticated user (shared pool) — no per-record ownership restrictions beyond the informational `owner_id` on Contact.

## 6. API Shape (high level)

REST JSON API under `/api`, e.g.:
- `POST /api/auth/login`, `POST /api/auth/logout`
- `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`
- `GET/POST /api/companies`, `GET/PATCH/DELETE /api/companies/:id`
- `GET/POST /api/contacts/:id/activity`
- `GET/POST /api/deals`, `GET/PATCH/DELETE /api/deals/:id`
- `GET/POST /api/tasks`, `PATCH /api/tasks/:id`
- `GET/POST /api/tags`
- `GET/POST /api/custom-fields`
- `POST /api/contacts/import` (CSV), `GET /api/contacts/export` (CSV)
- `GET/POST /api/users` (admin only), `PATCH /api/users/:id` (admin only)

## 7. Open Questions / Future Considerations

- Deal pipeline reporting/forecasting (totals by stage, win-rate) as a v2 module?
- Attachments/files on contacts (would require file storage, e.g. S3).
- Email/calendar sync for automatic activity logging.
- Audit log of edits (who changed what field, when).

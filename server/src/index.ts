import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { startEmailQueueWorker } from "./lib/emailQueue";
import { requireAuth, requireAdmin } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { companiesRouter } from "./routes/companies";
import { dealsRouter } from "./routes/deals";
import { directoryRouter } from "./routes/directory";
import { emailRouter } from "./routes/email";
import { emailThreadsRouter } from "./routes/emailThreads";
import { meRouter } from "./routes/me";
import { tagsRouter } from "./routes/tags";
import { customFieldsRouter } from "./routes/customFields";
import { tasksRouter } from "./routes/tasks";
import { usersRouter } from "./routes/users";

const app = express();

app.use(cors({ origin: env.clientOrigin }));
// Default 100kb is well under what a base64-encoded email attachment needs
// (see MAX_ATTACHMENTS_BYTES in routes/emailThreads.ts, 7MB of raw bytes ->
// ~9.3MB base64) — raised here so Express's own limit doesn't reject a
// within-cap attachment before our own, clearer validation ever runs.
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/contacts", requireAuth, contactsRouter);
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/deals", requireAuth, dealsRouter);
app.use("/api/directory", requireAuth, directoryRouter);
app.use("/api/email", requireAuth, requireAdmin, emailRouter);
app.use("/api/email-threads", requireAuth, emailThreadsRouter);
app.use("/api/me", requireAuth, meRouter);
app.use("/api/tags", requireAuth, tagsRouter);
app.use("/api/custom-fields", requireAuth, customFieldsRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
app.use("/api/users", requireAuth, requireAdmin, usersRouter);

app.listen(env.port, () => {
  console.log(`SimplyCRM API listening on port ${env.port}`);
});

startEmailQueueWorker();

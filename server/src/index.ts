import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { requireAuth, requireAdmin } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { companiesRouter } from "./routes/companies";
import { dealsRouter } from "./routes/deals";
import { directoryRouter } from "./routes/directory";
import { tagsRouter } from "./routes/tags";
import { customFieldsRouter } from "./routes/customFields";
import { tasksRouter } from "./routes/tasks";
import { usersRouter } from "./routes/users";

const app = express();

app.use(cors({ origin: env.clientOrigin }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/contacts", requireAuth, contactsRouter);
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/deals", requireAuth, dealsRouter);
app.use("/api/directory", requireAuth, directoryRouter);
app.use("/api/tags", requireAuth, tagsRouter);
app.use("/api/custom-fields", requireAuth, customFieldsRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
app.use("/api/users", requireAuth, requireAdmin, usersRouter);

app.listen(env.port, () => {
  console.log(`SimplyCRM API listening on port ${env.port}`);
});

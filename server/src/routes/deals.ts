import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUserSelect } from "../lib/publicUser";

export const dealsRouter = Router();

const DEAL_STAGES = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

const CLOSED_STAGES = new Set(["closed_won", "closed_lost"]);

dealsRouter.get("/", async (req, res) => {
  const { stage, ownerId, contactId, companyId } = req.query;

  const deals = await prisma.deal.findMany({
    where: {
      stage: stage ? (String(stage) as (typeof DEAL_STAGES)[number]) : undefined,
      ownerId: ownerId ? String(ownerId) : undefined,
      contactId: contactId ? String(contactId) : undefined,
      companyId: companyId ? String(companyId) : undefined,
    },
    include: { company: true, contact: true, owner: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
  });

  res.json({ deals });
});

dealsRouter.get("/:id", async (req, res) => {
  const deal = await prisma.deal.findUnique({
    where: { id: req.params.id },
    include: {
      company: true,
      contact: true,
      owner: { select: publicUserSelect },
      activities: { orderBy: { occurredAt: "desc" } },
    },
  });
  if (!deal) return res.status(404).json({ error: "Deal not found" });
  res.json({ deal });
});

const dealSchema = z.object({
  title: z.string().min(1),
  amount: z.number().nonnegative(),
  stage: z.enum(DEAL_STAGES).optional(),
  companyId: z.string().uuid().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  ownerId: z.string().uuid().optional().nullable(),
  expectedCloseDate: z.coerce.date().optional().nullable(),
});

dealsRouter.post("/", async (req, res) => {
  const parsed = dealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const deal = await prisma.deal.create({ data: parsed.data });
  res.status(201).json({ deal });
});

const dealUpdateSchema = dealSchema.partial();

dealsRouter.patch("/:id", async (req, res) => {
  const parsed = dealUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { stage, ...rest } = parsed.data;
  const deal = await prisma.deal.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      stage,
      closedAt: stage
        ? CLOSED_STAGES.has(stage)
          ? new Date()
          : null
        : undefined,
    },
  });
  res.json({ deal });
});

dealsRouter.delete("/:id", async (req, res) => {
  await prisma.deal.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

const activitySchema = z.object({
  type: z.enum(["note", "call", "email", "meeting"]),
  body: z.string().min(1),
  occurredAt: z.coerce.date().optional(),
});

dealsRouter.post("/:id/activity", async (req, res) => {
  const parsed = activitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  if (!deal) return res.status(404).json({ error: "Deal not found" });
  if (!deal.contactId) {
    return res
      .status(400)
      .json({ error: "This deal has no linked contact — activity requires one" });
  }

  const entry = await prisma.activity.create({
    data: {
      contactId: deal.contactId,
      dealId: deal.id,
      authorId: req.user.userId,
      type: parsed.data.type,
      body: parsed.data.body,
      occurredAt: parsed.data.occurredAt ?? new Date(),
    },
  });
  res.status(201).json({ activity: entry });
});

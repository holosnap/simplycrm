import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUserSelect } from "../lib/publicUser";

export const contactsRouter = Router();

contactsRouter.get("/", async (req, res) => {
  const { q, tag, companyId, ownerId, page = "1", pageSize = "25" } = req.query;

  const contacts = await prisma.contact.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { firstName: { contains: String(q), mode: "insensitive" } },
                { lastName: { contains: String(q), mode: "insensitive" } },
                { email: { contains: String(q), mode: "insensitive" } },
              ],
            }
          : {},
        companyId ? { companyId: String(companyId) } : {},
        ownerId ? { ownerId: String(ownerId) } : {},
        tag ? { tags: { some: { tag: { name: String(tag) } } } } : {},
      ],
    },
    include: {
      company: true,
      tags: { include: { tag: true } },
      owner: { select: publicUserSelect },
      activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
    },
    orderBy: { lastName: "asc" },
    skip: (Number(page) - 1) * Number(pageSize),
    take: Number(pageSize),
  });

  // Flatten the latest-activity lookup into a single field for the list view.
  const shaped = contacts.map(({ activities, ...contact }) => ({
    ...contact,
    lastActivityAt: activities[0]?.occurredAt ?? null,
  }));

  res.json({ contacts: shaped });
});

contactsRouter.get("/:id", async (req, res) => {
  const contact = await prisma.contact.findUnique({
    where: { id: req.params.id },
    include: {
      company: true,
      owner: { select: publicUserSelect },
      tags: { include: { tag: true } },
      activities: { orderBy: { occurredAt: "desc" } },
      tasks: true,
      deals: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!contact) return res.status(404).json({ error: "Contact not found" });
  res.json({ contact });
});

const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  ownerId: z.string().uuid().optional().nullable(),
});

contactsRouter.post("/", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const contact = await prisma.contact.create({ data: parsed.data });
  res.status(201).json({ contact });
});

contactsRouter.patch("/:id", async (req, res) => {
  const parsed = contactSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const contact = await prisma.contact.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ contact });
});

contactsRouter.delete("/:id", async (req, res) => {
  await prisma.contact.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

const activitySchema = z.object({
  type: z.enum(["note", "call", "email", "meeting"]),
  body: z.string().min(1),
  occurredAt: z.coerce.date().optional(),
});

contactsRouter.post("/:id/activity", async (req, res) => {
  const parsed = activitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const entry = await prisma.activity.create({
    data: {
      contactId: req.params.id,
      authorId: req.user.userId,
      type: parsed.data.type,
      body: parsed.data.body,
      occurredAt: parsed.data.occurredAt ?? new Date(),
    },
  });
  res.status(201).json({ activity: entry });
});

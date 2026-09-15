import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUserSelect } from "../lib/publicUser";

export const tasksRouter = Router();

tasksRouter.get("/", async (req, res) => {
  const { status, assigneeId, contactId } = req.query;
  const tasks = await prisma.task.findMany({
    where: {
      status: status ? (status as "open" | "done") : undefined,
      assigneeId: assigneeId ? String(assigneeId) : undefined,
      contactId: contactId ? String(contactId) : undefined,
    },
    include: { contact: true, assignee: { select: publicUserSelect } },
    orderBy: { dueAt: "asc" },
  });
  res.json({ tasks });
});

const taskSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  assigneeId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
});

tasksRouter.post("/", async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const task = await prisma.task.create({ data: parsed.data });
  res.status(201).json({ task });
});

const taskUpdateSchema = taskSchema.partial().extend({
  status: z.enum(["open", "done"]).optional(),
});

tasksRouter.patch("/:id", async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { status, ...rest } = parsed.data;
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      status,
      completedAt: status === "done" ? new Date() : status === "open" ? null : undefined,
    },
  });
  res.json({ task });
});

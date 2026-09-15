import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const customFieldsRouter = Router();

customFieldsRouter.get("/", async (req, res) => {
  const { appliesTo } = req.query;
  const fields = await prisma.customFieldDefinition.findMany({
    where: appliesTo ? { appliesTo: appliesTo as "contact" | "company" } : undefined,
  });
  res.json({ fields });
});

const fieldSchema = z.object({
  name: z.string().min(1),
  fieldType: z.enum(["text", "number", "date", "boolean"]),
  appliesTo: z.enum(["contact", "company"]),
});

customFieldsRouter.post("/", async (req, res) => {
  const parsed = fieldSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const field = await prisma.customFieldDefinition.create({ data: parsed.data });
  res.status(201).json({ field });
});

customFieldsRouter.delete("/:id", async (req, res) => {
  await prisma.customFieldDefinition.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

const valueSchema = z.object({
  fieldId: z.string().uuid(),
  recordId: z.string().uuid(),
  value: z.string(),
});

customFieldsRouter.post("/values", async (req, res) => {
  const parsed = valueSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const value = await prisma.customFieldValue.create({ data: parsed.data });
  res.status(201).json({ value });
});

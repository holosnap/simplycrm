import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const tagsRouter = Router();

tagsRouter.get("/", async (_req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  res.json({ tags });
});

const tagSchema = z.object({ name: z.string().min(1) });

tagsRouter.post("/", async (req, res) => {
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tag = await prisma.tag.create({ data: parsed.data });
  res.status(201).json({ tag });
});

tagsRouter.delete("/:id", async (req, res) => {
  await prisma.tag.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

tagsRouter.post("/:tagId/contacts/:contactId", async (req, res) => {
  const link = await prisma.contactTag.create({
    data: { tagId: req.params.tagId, contactId: req.params.contactId },
  });
  res.status(201).json({ link });
});

tagsRouter.delete("/:tagId/contacts/:contactId", async (req, res) => {
  await prisma.contactTag.delete({
    where: {
      contactId_tagId: { tagId: req.params.tagId, contactId: req.params.contactId },
    },
  });
  res.status(204).end();
});

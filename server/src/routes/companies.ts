import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const companiesRouter = Router();

companiesRouter.get("/", async (req, res) => {
  const { q } = req.query;
  const companies = await prisma.company.findMany({
    where: q ? { name: { contains: String(q), mode: "insensitive" } } : undefined,
    include: { _count: { select: { contacts: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ companies });
});

companiesRouter.get("/:id", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { contacts: true },
  });
  if (!company) return res.status(404).json({ error: "Company not found" });
  res.json({ company });
});

const companySchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

companiesRouter.post("/", async (req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const company = await prisma.company.create({ data: parsed.data });
  res.status(201).json({ company });
});

companiesRouter.patch("/:id", async (req, res) => {
  const parsed = companySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ company });
});

companiesRouter.delete("/:id", async (req, res) => {
  await prisma.company.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

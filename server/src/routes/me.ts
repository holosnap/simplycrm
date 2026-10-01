import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const meRouter = Router();

const updateMeSchema = z.object({
  signatureText: z.string().optional().nullable(),
});

meRouter.patch("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.user.userId },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true, signatureText: true },
  });

  res.json({ user });
});

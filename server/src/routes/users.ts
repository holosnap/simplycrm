import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const usersRouter = Router();

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true, lastLoginAt: true },
    orderBy: { name: "asc" },
  });
  res.json({ users });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "user"]).default("user"),
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      passwordHash,
    },
    select: { id: true, name: true, email: true, role: true },
  });
  res.status(201).json({ user });
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "user"]).optional(),
});

usersRouter.patch("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true },
  });
  res.json({ user });
});

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { publicUserSelect } from "../lib/publicUser";

// Read-only staff roster (id/name/email/role) any authenticated user can see,
// so they can assign a Contact/Deal owner without needing admin's full
// user-management access (create/edit/role-change stays under /api/users).
export const directoryRouter = Router();

directoryRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: publicUserSelect,
    orderBy: { name: "asc" },
  });
  res.json({ users });
});

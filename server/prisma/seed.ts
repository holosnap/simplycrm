import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const passwordHash = await bcrypt.hash("changeme123", 10);
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      passwordHash,
    },
  });
  console.log("Seeded admin@example.com / changeme123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import type { DealStage, ActivityType } from "@prisma/client";

const DEAL_STAGES: DealStage[] = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

const ACTIVITY_TYPES: ActivityType[] = ["note", "call", "email", "meeting"];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function activityBody(type: ActivityType): string {
  const topic = faker.helpers.arrayElement([
    "pricing",
    "the renewal timeline",
    "onboarding",
    "the proposal",
    "next steps",
    "budget approval",
    "a product demo",
    "integration requirements",
  ]);

  switch (type) {
    case "call":
      return `Called to discuss ${topic}. ${faker.helpers.arrayElement([
        "Left a voicemail.",
        "Good conversation, follow-up needed.",
        "They asked for more time to decide.",
        "Ready to move forward.",
      ])}`;
    case "email":
      return `Sent an email about ${topic}. ${faker.helpers.arrayElement([
        "Awaiting reply.",
        "They responded with questions.",
        "Confirmed receipt.",
      ])}`;
    case "meeting":
      return `Met to go over ${topic}. ${faker.helpers.arrayElement([
        "Positive outcome, scheduling a follow-up.",
        "Raised some concerns about timeline.",
        "Decision-makers were aligned.",
      ])}`;
    case "note":
    default:
      return faker.helpers.arrayElement([
        `Mentioned they're also evaluating ${faker.company.name()}.`,
        `Prefers ${faker.helpers.arrayElement(["email", "phone", "Slack"])} for follow-ups.`,
        `Budget cycle ends ${faker.helpers.arrayElement(["this quarter", "next quarter", "end of year"])}.`,
        `Key stakeholder is out until ${faker.date.soon({ days: 14 }).toLocaleDateString()}.`,
      ]);
  }
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash("changeme123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: { email: "admin@example.com", name: "Admin", role: "admin", passwordHash },
  });

  const teamNames = ["Jordan Lee", "Priya Patel", "Sam Ortiz"];
  const users = [admin];
  for (const name of teamNames) {
    const email = `${name.toLowerCase().replace(" ", ".")}@example.com`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role: "user", passwordHash },
    });
    users.push(user);
  }
  return users;
}

async function main() {
  // Clear existing demo data (keep it idempotent for repeated `prisma db seed` runs).
  await prisma.activity.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.contactTag.deleteMany();
  await prisma.task.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.tag.deleteMany();

  const users = await seedUsers();

  const tags = await Promise.all(
    ["vip", "newsletter", "cold-lead", "partner"].map((name) =>
      prisma.tag.create({ data: { name } }),
    ),
  );

  const companies = await Promise.all(
    Array.from({ length: 5 }).map(() =>
      prisma.company.create({
        data: {
          name: faker.company.name(),
          domain: faker.internet.domainName(),
          notes: faker.datatype.boolean() ? faker.company.catchPhrase() : null,
        },
      }),
    ),
  );

  const contacts = await Promise.all(
    Array.from({ length: 10 }).map(async () => {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const company = pick(companies);
      const contact = await prisma.contact.create({
        data: {
          firstName,
          lastName,
          email: faker.internet.email({ firstName, lastName }).toLowerCase(),
          phone: faker.phone.number(),
          title: faker.person.jobTitle(),
          companyId: company.id,
          ownerId: pick(users).id,
        },
      });

      // Randomly tag ~half the contacts with 1-2 tags.
      if (faker.datatype.boolean()) {
        const tagCount = faker.number.int({ min: 1, max: 2 });
        const chosenTags = faker.helpers.arrayElements(tags, tagCount);
        await Promise.all(
          chosenTags.map((tag) =>
            prisma.contactTag.create({ data: { contactId: contact.id, tagId: tag.id } }),
          ),
        );
      }

      return { ...contact, company };
    }),
  );

  const deals = await Promise.all(
    Array.from({ length: 6 }).map(() => {
      const contact = pick(contacts);
      const stage = pick(DEAL_STAGES);
      const isClosed = stage === "closed_won" || stage === "closed_lost";
      return prisma.deal.create({
        data: {
          title: `${contact.company.name} — ${faker.helpers.arrayElement([
            "Annual Contract",
            "Platform Upgrade",
            "Enterprise Rollout",
            "Renewal",
            "Expansion Package",
            "Implementation Services",
          ])}`,
          amount: faker.number.int({ min: 1_000, max: 120_000 }),
          stage,
          companyId: contact.companyId,
          contactId: contact.id,
          ownerId: pick(users).id,
          expectedCloseDate: faker.date.soon({ days: 60 }),
          closedAt: isClosed ? faker.date.recent({ days: 30 }) : null,
        },
      });
    }),
  );

  await Promise.all(
    Array.from({ length: 10 }).map(() => {
      const contact = pick(contacts);
      const attachToDeal = faker.datatype.boolean();
      const dealForContact = deals.find((d) => d.contactId === contact.id);
      const type = pick(ACTIVITY_TYPES);
      return prisma.activity.create({
        data: {
          contactId: contact.id,
          dealId: attachToDeal ? (dealForContact?.id ?? null) : null,
          authorId: pick(users).id,
          type,
          body: activityBody(type),
          occurredAt: faker.date.recent({ days: 45 }),
        },
      });
    }),
  );

  console.log("Seeded:");
  console.log(`  ${users.length} users (admin@example.com / changeme123)`);
  console.log(`  ${companies.length} companies`);
  console.log(`  ${contacts.length} contacts`);
  console.log(`  ${deals.length} deals`);
  console.log(`  10 activities`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

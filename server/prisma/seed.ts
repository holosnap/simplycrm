import { randomUUID } from "node:crypto";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import type { Contact, DealStage, ActivityType, User } from "@prisma/client";

// Matches the default SES_SENDING_DOMAIN in server/.env.example — seed data
// is never actually sent, so this just needs to look like a real domain.
const SEED_SENDING_DOMAIN = "mail.simplycrm.app";

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
    create: {
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      passwordHash,
      signatureText: "Best,\nAdmin\nSimplyCRM",
    },
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

function textToHtml(text: string): string {
  return `<p>${text.replace(/\n/g, "<br>")}</p>`;
}

// A handful of realistic, already-"sent" threads so the Email section on a
// Contact/Deal isn't empty in a fresh seed. Written directly with
// status: "sent" and a fake sesMessageId — this bypasses the real send
// queue entirely (seed data is never meant to actually go out).
async function seedEmailThreads(contacts: (Contact & { company: { name: string } })[], users: User[]) {
  const sample = faker.helpers.arrayElements(contacts, 4);

  for (const contact of sample) {
    const author = pick(users);
    const subject = faker.helpers.arrayElement([
      "Following up on our call",
      "Quick question about your rollout timeline",
      "Pricing details as discussed",
      "Checking in",
    ]);
    const sentAt = faker.date.recent({ days: 20 });
    const firstBody = `Hi ${contact.firstName},\n\n${faker.lorem.sentences(2)}\n\nBest,\n${author.name}`;

    const thread = await prisma.emailThread.create({
      data: { contactId: contact.id, subject, lastMessageAt: sentAt },
    });

    const firstMessage = await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        contactId: contact.id,
        direction: "outbound",
        authorId: author.id,
        rfc822MessageId: `<msg-${randomUUID()}@${SEED_SENDING_DOMAIN}>`,
        fromAddress: "notifications@" + SEED_SENDING_DOMAIN,
        toAddresses: contact.email ? [contact.email] : ["prospect@example.com"],
        subject,
        bodyText: firstBody,
        bodyHtml: textToHtml(firstBody),
        status: "sent",
        sesMessageId: randomUUID(),
        sentAt,
      },
    });

    // About half get a reply continuing the thread, to show threading in the demo.
    if (faker.datatype.boolean()) {
      const replyAt = faker.date.soon({ days: 3, refDate: sentAt });
      const replyBody = `Hi ${contact.firstName},\n\n${faker.lorem.sentence()}\n\nBest,\n${author.name}`;
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          contactId: contact.id,
          direction: "outbound",
          authorId: author.id,
          rfc822MessageId: `<msg-${randomUUID()}@${SEED_SENDING_DOMAIN}>`,
          inReplyTo: firstMessage.rfc822MessageId,
          fromAddress: "notifications@" + SEED_SENDING_DOMAIN,
          toAddresses: firstMessage.toAddresses,
          subject: subject.match(/^re:/i) ? subject : `Re: ${subject}`,
          bodyText: replyBody,
          bodyHtml: textToHtml(replyBody),
          status: "sent",
          sesMessageId: randomUUID(),
          sentAt: replyAt,
        },
      });
      await prisma.emailThread.update({ where: { id: thread.id }, data: { lastMessageAt: replyAt } });
    }
  }

  return sample.length;
}

async function main() {
  // Clear existing demo data (keep it idempotent for repeated `prisma db seed` runs).
  await prisma.emailMessage.deleteMany();
  await prisma.emailThread.deleteMany();
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

  const emailThreadCount = await seedEmailThreads(contacts, users);

  console.log("Seeded:");
  console.log(`  ${users.length} users (admin@example.com / changeme123)`);
  console.log(`  ${companies.length} companies`);
  console.log(`  ${contacts.length} contacts`);
  console.log(`  ${deals.length} deals`);
  console.log(`  10 activities`);
  console.log(`  ${emailThreadCount} email threads (already "sent" — demo data, never actually sent)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

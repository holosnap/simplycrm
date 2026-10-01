import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityDkimAttributesCommand,
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  UpdateConfigurationSetEventDestinationCommand,
  PutAccountSuppressionAttributesCommand,
  PutAccountVdmAttributesCommand,
  GetAccountCommand,
  type EventType,
} from "@aws-sdk/client-sesv2";
import { SNSClient, CreateTopicCommand } from "@aws-sdk/client-sns";

// One-time (re-runnable) provisioning for the SES foundation described in
// SETUP.md / EMAIL_SPEC.md. This is an operator script, not app code — run
// it with your own AWS credentials (broader than the app's runtime IAM
// policy in server/aws/ses-iam-policy.json), not in production request paths.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name} (see server/.env.example)`);
    process.exit(1);
  }
  return value;
}

const region = requireEnv("AWS_REGION");
const sendingDomain = requireEnv("SES_SENDING_DOMAIN");
const configurationSetName = requireEnv("SES_CONFIGURATION_SET");
const eventsTopicName = process.env.SES_EVENTS_TOPIC_NAME || `${configurationSetName}-events`;

const EVENT_TYPES: EventType[] = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT", "DELIVERY_DELAY"];

const ses = new SESv2Client({ region });
const sns = new SNSClient({ region });

function isAwsError(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

async function ensureIdentity(): Promise<{ tokens: string[]; status?: string }> {
  try {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: sendingDomain }));
    console.log(`Created identity ${sendingDomain} (Easy DKIM, AWS-managed key).`);
  } catch (err) {
    if (isAwsError(err, "AlreadyExistsException")) {
      console.log(`Identity ${sendingDomain} already exists — reusing it.`);
    } else {
      throw err;
    }
  }

  // Explicit regardless of create-vs-reuse, so a previously-disabled signing
  // state gets corrected on re-run too.
  await ses.send(
    new PutEmailIdentityDkimAttributesCommand({ EmailIdentity: sendingDomain, SigningEnabled: true }),
  );

  const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: sendingDomain }));
  return { tokens: identity.DkimAttributes?.Tokens ?? [], status: identity.DkimAttributes?.Status };
}

async function ensureEventsTopic(): Promise<string> {
  // SNS CreateTopic is idempotent by name — re-calling it just returns the
  // same topic's ARN rather than erroring.
  const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: eventsTopicName }));
  if (!TopicArn) throw new Error("SNS CreateTopic did not return a TopicArn");
  console.log(`SNS topic ready: ${TopicArn}`);
  return TopicArn;
}

async function ensureConfigurationSet() {
  try {
    await ses.send(
      new CreateConfigurationSetCommand({
        ConfigurationSetName: configurationSetName,
        ReputationOptions: { ReputationMetricsEnabled: true },
        SendingOptions: { SendingEnabled: true },
      }),
    );
    console.log(`Created configuration set "${configurationSetName}" (reputation metrics on).`);
  } catch (err) {
    if (isAwsError(err, "AlreadyExistsException")) {
      console.log(`Configuration set "${configurationSetName}" already exists — reusing it.`);
    } else {
      throw err;
    }
  }
}

async function ensureEventDestination(topicArn: string) {
  const destinationName = `${configurationSetName}-sns`;
  const EventDestination = { Enabled: true, MatchingEventTypes: EVENT_TYPES, SnsDestination: { TopicArn: topicArn } };

  try {
    await ses.send(
      new CreateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: configurationSetName,
        EventDestinationName: destinationName,
        EventDestination,
      }),
    );
    console.log(`Created event destination "${destinationName}" -> ${topicArn}.`);
  } catch (err) {
    if (isAwsError(err, "AlreadyExistsException")) {
      // Converge to the desired event list/topic rather than leaving
      // whatever was there before — re-running this script should always
      // produce the same end state.
      await ses.send(
        new UpdateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: configurationSetName,
          EventDestinationName: destinationName,
          EventDestination,
        }),
      );
      console.log(`Updated existing event destination "${destinationName}" to match the desired config.`);
    } else {
      throw err;
    }
  }
  console.log(`  Subscribed events: ${EVENT_TYPES.join(", ")}`);
}

async function ensureAccountSuppression() {
  await ses.send(new PutAccountSuppressionAttributesCommand({ SuppressedReasons: ["BOUNCE", "COMPLAINT"] }));
  console.log("Account-level suppression list enabled for BOUNCE and COMPLAINT.");
}

async function ensureAccountReputationTracking() {
  // Distinct from the configuration set's ReputationOptions above: this is
  // the account-wide Virtual Deliverability Manager dashboard. Best-effort —
  // VDM is a newer SES surface that may not be fully available in every
  // account/region, so a failure here shouldn't abort the rest of setup.
  try {
    await ses.send(
      new PutAccountVdmAttributesCommand({
        VdmAttributes: {
          VdmEnabled: "ENABLED",
          DashboardAttributes: { EngagementMetrics: "ENABLED" },
          GuardianAttributes: { OptimizedSharedDelivery: "ENABLED" },
        },
      }),
    );
    console.log("Account-level reputation dashboard (Virtual Deliverability Manager) enabled.");
  } catch (err) {
    console.warn(
      "Could not enable account-level VDM reputation tracking (non-fatal, continuing):",
      err instanceof Error ? err.message : err,
    );
  }
}

function updateSetupMdChecklist(tokens: string[]) {
  const setupMdPath = join(__dirname, "..", "..", "SETUP.md");
  const original = readFileSync(setupMdPath, "utf8");

  const rows = tokens
    .map(
      (token, i) =>
        `| DKIM CNAME ${i + 1} | \`${token}._domainkey.${sendingDomain}\` | CNAME | \`${token}.dkim.amazonses.com\` |`,
    )
    .join("\n");

  const block = [
    "<!-- DKIM:START (generated by scripts/ses-setup.ts — do not hand-edit this block) -->",
    "| Record | Name | Type | Value |",
    "|---|---|---|---|",
    rows,
    "<!-- DKIM:END -->",
  ].join("\n");

  const markerPattern = /<!-- DKIM:START.*?-->[\s\S]*?<!-- DKIM:END -->/;
  if (!markerPattern.test(original)) {
    console.warn("Could not find the DKIM marker block in SETUP.md — leaving it untouched.");
    return;
  }

  writeFileSync(setupMdPath, original.replace(markerPattern, block));
  console.log("Updated SETUP.md with the live DKIM CNAME records.");
}

async function main() {
  console.log(`\nProvisioning SES foundation in ${region} for "${sendingDomain}"...\n`);

  const { tokens, status } = await ensureIdentity();
  const topicArn = await ensureEventsTopic();
  await ensureConfigurationSet();
  await ensureEventDestination(topicArn);
  await ensureAccountSuppression();
  await ensureAccountReputationTracking();

  if (tokens.length > 0) {
    updateSetupMdChecklist(tokens);
  } else {
    console.warn("No DKIM tokens returned yet — re-run this script in a minute if this persists.");
  }

  const account = await ses.send(new GetAccountCommand({}));

  console.log("\nDone. Current account status:");
  console.log(`  Sending enabled:    ${account.SendingEnabled}`);
  console.log(`  Production access:  ${account.ProductionAccessEnabled}`);
  console.log(`  DKIM status:        ${status}`);
  console.log("\nNext: add the DNS records from SETUP.md, then check back — DKIM verification");
  console.log("can take a few minutes up to ~72h after the records propagate.");
}

main().catch((err) => {
  console.error("\nSES setup failed:", err);
  process.exit(1);
});

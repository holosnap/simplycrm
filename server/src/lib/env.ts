import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET"),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",

  // SES is an optional integration — these are left unset (not `required()`)
  // so the app boots fine before it's provisioned. Credentials are never
  // read here: the AWS SDK's default provider chain handles that (env vars
  // locally, an IAM role in deployment). See SETUP.md.
  awsRegion: process.env.AWS_REGION,
  sesSendingDomain: process.env.SES_SENDING_DOMAIN,
  sesConfigurationSet: process.env.SES_CONFIGURATION_SET,
  sesFromAddress: process.env.SES_FROM_ADDRESS,

  // IMAP (inbound) is likewise optional. Unlike AWS, plain IMAP auth has no
  // ambient credential chain to defer to — imapflow needs the password
  // handed to it directly — so this is the one place it's read from env,
  // passed straight into the ImapFlow client (src/lib/imapSync.ts), and
  // never logged, stored, or passed anywhere else.
  imapHost: process.env.IMAP_HOST,
  imapPort: process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993,
  imapSecure: process.env.IMAP_SECURE !== "false",
  imapUser: process.env.IMAP_USER,
  imapPassword: process.env.IMAP_PASSWORD,
  imapInboxFolder: process.env.IMAP_INBOX_FOLDER ?? "INBOX",
  imapSentFolder: process.env.IMAP_SENT_FOLDER ?? "Sent",
  imapPollIntervalMs: Number(process.env.IMAP_POLL_INTERVAL_MS ?? 60_000),
  // Sending domain also used as the fallback Message-ID host for inbound
  // mail that arrives with no Message-ID header at all (rare, but happens).
  imapFallbackMessageIdHost: process.env.SES_SENDING_DOMAIN ?? "localhost",
};

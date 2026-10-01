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
};

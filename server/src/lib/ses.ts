import { SESv2Client } from "@aws-sdk/client-sesv2";
import { env } from "./env";

// Credentials are intentionally never read or passed here. The client's
// default provider chain resolves them on its own — AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY env vars locally, an IAM role automatically in
// deployment — so no access key ever passes through our code or gets
// persisted anywhere (see SETUP.md). Don't add a `credentials` option here.
export const sesClient = new SESv2Client(env.awsRegion ? { region: env.awsRegion } : {});

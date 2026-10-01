import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

// Credentials are intentionally never read or passed here — same default
// provider chain as the SES client (src/lib/ses.ts). Don't add a
// `credentials` option here.
export const s3Client = new S3Client(env.attachmentsS3Region ? { region: env.attachmentsS3Region } : {});

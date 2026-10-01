import { Router } from "express";
import { GetAccountCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { sesClient } from "../lib/ses";
import { env } from "../lib/env";

export const emailRouter = Router();

// SES v1 (the classic SES API) has a standalone `GetAccountSendingEnabled`
// call. We're on SES v2 (`@aws-sdk/client-sesv2`, per EMAIL_SPEC.md) where
// that's folded into `GetAccount`, which returns `SendingEnabled` alongside
// quota/suppression/reputation info — so that's what this calls instead.
emailRouter.get("/health", async (_req, res) => {
  if (!env.awsRegion || !env.sesSendingDomain) {
    return res.json({
      configured: false,
      message: "AWS_REGION and SES_SENDING_DOMAIN are not set — see SETUP.md.",
    });
  }

  try {
    const [account, identity] = await Promise.all([
      sesClient.send(new GetAccountCommand({})),
      sesClient.send(new GetEmailIdentityCommand({ EmailIdentity: env.sesSendingDomain })),
    ]);

    res.json({
      configured: true,
      checkedAt: new Date().toISOString(),
      account: {
        sendingEnabled: account.SendingEnabled ?? false,
        productionAccessEnabled: account.ProductionAccessEnabled ?? false,
        enforcementStatus: account.EnforcementStatus,
        suppressedReasons: account.SuppressionAttributes?.SuppressedReasons ?? [],
      },
      identity: {
        name: env.sesSendingDomain,
        verifiedForSendingStatus: identity.VerifiedForSendingStatus ?? false,
        verificationStatus: identity.VerificationStatus,
        configurationSetName: identity.ConfigurationSetName,
        dkim: {
          status: identity.DkimAttributes?.Status,
          signingEnabled: identity.DkimAttributes?.SigningEnabled ?? false,
          tokens: identity.DkimAttributes?.Tokens ?? [],
        },
      },
    });
  } catch (err) {
    res.json({
      configured: true,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Unknown error contacting AWS SES.",
    });
  }
});

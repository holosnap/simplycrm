import { GetAccountCommand } from "@aws-sdk/client-sesv2";
import { sesClient } from "./ses";

// `GetSendQuota` (with its `MaxSendRate` field) is the SES v1 API call for
// this. On the v2 API this repo uses, that same data comes back as
// `SendQuota.MaxSendRate` on `GetAccount` instead — so that's what this
// calls (same situation as GetAccountSendingEnabled -> GetAccount.SendingEnabled
// in the health-check route; see SETUP.md).

const CACHE_TTL_MS = 60_000;

// SES sandbox accounts default to 1 msg/sec — a safe floor to assume before
// we've ever successfully asked AWS, or if AWS is temporarily unreachable.
const FALLBACK_MAX_SEND_RATE = 1;

let cached: { maxSendRate: number; fetchedAt: number } | null = null;

export async function getMaxSendRate(): Promise<number> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.maxSendRate;
  }

  try {
    const account = await sesClient.send(new GetAccountCommand({}));
    const rate = account.SendQuota?.MaxSendRate;
    if (rate && rate > 0) {
      cached = { maxSendRate: rate, fetchedAt: Date.now() };
      return rate;
    }
  } catch (err) {
    console.warn(
      "Could not fetch SES send quota, using",
      cached?.maxSendRate ?? FALLBACK_MAX_SEND_RATE,
      "msg/s:",
      err instanceof Error ? err.message : err,
    );
  }

  // Prefer a stale-but-real cached value over hammering a failing API or
  // over-trusting the conservative fallback once we've actually seen a
  // higher real quota before.
  return cached?.maxSendRate ?? FALLBACK_MAX_SEND_RATE;
}

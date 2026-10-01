// Explicitly permanent per spec: no amount of retrying fixes a rejected
// message or a suspended account. Everything else (throttling, other 4xx-ish
// SES errors, network failures, unknown errors) is treated as transient and
// retried with backoff, up to MAX_ATTEMPTS — which is the real backstop
// against retrying forever, not the error classification itself.
const PERMANENT_ERROR_NAMES = new Set(["MessageRejected", "AccountSuspendedException"]);

export function isPermanentError(err: unknown): boolean {
  return err instanceof Error && PERMANENT_ERROR_NAMES.has(err.name);
}

export const MAX_ATTEMPTS = 8;

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 15 * 60 * 1000;

// "Full jitter" exponential backoff (AWS's own recommended formula): a
// random value between 0 and min(cap, base * 2^attempt), rather than a fixed
// delay, so many simultaneously-failing sends don't all retry in lockstep.
export function backoffDelayMs(attempt: number): number {
  const upperBound = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * upperBound);
}

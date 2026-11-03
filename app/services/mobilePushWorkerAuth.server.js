import { timingSafeEqual } from "node:crypto";

function matchesBearer(request, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// The GitHub Actions worker sends PUSH_WORKER_SECRET; Vercel Cron sends CRON_SECRET.
export function authorizePushWorker(request, secret = process.env.PUSH_WORKER_SECRET, cronSecret = process.env.CRON_SECRET) {
  return matchesBearer(request, secret) || matchesBearer(request, cronSecret);
}

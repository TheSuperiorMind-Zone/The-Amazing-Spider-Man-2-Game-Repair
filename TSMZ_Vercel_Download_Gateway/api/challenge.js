import {
  clientIp, hashIp, randomId, redis, sendError, sendJson
} from "../lib/security.js";

const LIMIT = 12;
const WINDOW_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_SECONDS = 120;
const POW_BITS = 14;

export default async function handler(req, res) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed.");
  try {
    const assetId = String(req.query.asset || "");
    const { ASSET_MAP } = await import("../lib/security.js");
    if (!ASSET_MAP.has(assetId)) return sendError(res, 404, "File not found.");

    const ipHash = hashIp(clientIp(req));
    const limit = await (await import("../lib/security.js")).takeSlidingLimit(
      "challenge:ip:" + ipHash, LIMIT, WINDOW_MS
    );
    if (!limit.allowed) return sendError(res, 429, "Too many verification requests. Wait before retrying.", limit.retryMs);

    const challengeId = randomId(18);
    const nonce = randomId(24);
    const value = { assetId, nonce, ipHash, bits: POW_BITS, exp: Date.now() + CHALLENGE_TTL_SECONDS * 1000 };
    await redis().set("challenge:" + challengeId, JSON.stringify(value), { ex: CHALLENGE_TTL_SECONDS, nx: true });
    return sendJson(res, 200, { challengeId, nonce, bits: POW_BITS, expiresIn: CHALLENGE_TTL_SECONDS });
  } catch (error) {
    console.error("challenge error:", error?.message || "unknown");
    return sendError(res, 503, "Verification service is temporarily unavailable.");
  }
}

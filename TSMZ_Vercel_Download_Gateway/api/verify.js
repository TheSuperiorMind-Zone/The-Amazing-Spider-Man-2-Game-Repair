import {
  ASSET_MAP, clientIp, hashIp, proofIsValid, randomId,
  sendError, sendJson, signDownload, takeSlidingLimit, parseStoredJson, consumeRedisValue
} from "../lib/security.js";

const LIMIT = 12;
const WINDOW_MS = 10 * 60 * 1000;
const TOKEN_TTL_SECONDS = 120;

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed.");
  try {
    const input = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const assetId = String(input.assetId || "");
    const challengeId = String(input.challengeId || "");
    const answer = String(input.answer || "");
    if (!ASSET_MAP.has(assetId) || !challengeId || challengeId.length > 128) {
      return sendError(res, 400, "Invalid verification request.");
    }

    const ipHash = hashIp(clientIp(req));
    const limit = await takeSlidingLimit("verify:ip:" + ipHash, LIMIT, WINDOW_MS);
    if (!limit.allowed) return sendError(res, 429, "Verification limit reached. Wait before trying again.", limit.retryMs);

    const key = "challenge:" + challengeId;
    const challenge = parseStoredJson(await consumeRedisValue(key));
    if (!challenge || challenge.assetId !== assetId || challenge.ipHash !== ipHash ||
        challenge.exp < Date.now() || !proofIsValid(challenge.nonce, answer, challenge.bits)) {
      return sendError(res, 403, "Verification failed or expired. Return to the download page and try again.");
    }

    const token = signDownload({
      v: 1,
      assetId,
      ipHash,
      exp: Date.now() + TOKEN_TTL_SECONDS * 1000,
      nonce: randomId(24)
    });
    return sendJson(res, 200, {
      downloadUrl: "/api/file?asset=" + encodeURIComponent(assetId) + "&token=" + encodeURIComponent(token)
    });
  } catch (error) {
    console.error("verify error:", error?.message || "unknown");
    return sendError(res, 503, "Verification service is temporarily unavailable.");
  }
}

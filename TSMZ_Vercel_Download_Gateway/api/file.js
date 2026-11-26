import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import {
  ASSET_MAP, clientIp, hashIp, parseCookies, parseStoredJson, randomId,
  readDownloadToken, redis, redeemDownloadSlot, sendError
} from "../lib/security.js";

const SESSION_TTL_SECONDS = 900;
const MAX_SESSION_REQUESTS = 20;

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename);
}

async function streamPrivateBlob(res, asset, blob) {
  if (!blob || blob.statusCode !== 200 || !blob.stream) return false;

  setSecurityHeaders(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", asset.contentType || blob.blob?.contentType || "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(asset.filename));
  if (Number.isSafeInteger(blob.blob?.size)) res.setHeader("Content-Length", String(blob.blob.size));
  res.setHeader("Accept-Ranges", "none");
  Readable.fromWeb(blob.stream).on("error", () => res.destroy()).pipe(res);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed.");
  try {
    const assetId = String(req.query.asset || "");
    const asset = ASSET_MAP.get(assetId);
    if (!asset) return sendError(res, 404, "File not found.");

    const ipHash = hashIp(clientIp(req));
    const token = readDownloadToken(String(req.query.token || ""));
    if (!token || token.assetId !== assetId || token.ipHash !== ipHash) {
      return sendError(res, 403, "Download link is not valid for this file or connection. Verify again.");
    }

    // The cookie name is derived from the signed token nonce. A previous session
    // cannot be reused to bypass the quota for a newly issued download link.
    const cookieName = "tsmz_dl_" + token.nonce;
    const cookie = parseCookies(req)[cookieName];
    let session = null;
    if (cookie && /^[A-Za-z0-9_-]{32,80}$/.test(cookie)) {
      session = parseStoredJson(await redis().get("download:session:" + cookie));
    }

    if (session) {
      if (session.assetId !== assetId || session.ipHash !== ipHash ||
          session.nonce !== token.nonce || session.exp < Date.now()) {
        return sendError(res, 403, "Download session is not valid for this file or connection.");
      }
      const count = Number(await redis().incr("download:session-requests:" + cookie));
      if (count > MAX_SESSION_REQUESTS) return sendError(res, 429, "Download session request limit reached.");
      const blob = await get(asset.pathname, { access: "private" });
      return await streamPrivateBlob(res, asset, blob)
        ? undefined
        : sendError(res, 404, "The private file is not available.");
    }

    if (token.exp < Date.now() || token.exp > Date.now() + 120_000 + 5_000) {
      return sendError(res, 403, "Download link expired. Verify again.");
    }

    // Resolve the private object before consuming a quota slot.
    const blob = await get(asset.pathname, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return sendError(res, 404, "The private file is not available.");
    }

    const sessionId = randomId(32);
    const sessionValue = {
      assetId,
      ipHash,
      nonce: token.nonce,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000
    };
    const redeemed = await redeemDownloadSlot({
      ipHash,
      nonce: token.nonce,
      sessionId,
      sessionValue
    });
    if (redeemed.replay) return sendError(res, 409, "This download link has already been used. Verify again.");
    if (!redeemed.allowed) {
      return sendError(res, 429,
        "Download limit reached: at most three download starts per IP in a rolling 20-second window.",
        redeemed.retryMs);
    }

    res.setHeader("Set-Cookie",
      cookieName + "=" + sessionId + "; Max-Age=" + SESSION_TTL_SECONDS +
      "; Path=/api/file; HttpOnly; Secure; SameSite=Lax");
    return streamPrivateBlob(res, asset, blob)
      ? undefined
      : sendError(res, 404, "The private file is not available.");
  } catch (error) {
    console.error("file delivery error:", error?.message || "unknown");
    return sendError(res, 503, "Download service is temporarily unavailable.");
  }
}

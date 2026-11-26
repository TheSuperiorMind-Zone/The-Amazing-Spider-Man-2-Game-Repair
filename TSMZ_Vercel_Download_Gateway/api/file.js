import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import {
  ASSET_MAP, clientIp, hashIp, readDownloadToken,
  redeemDownloadSlot, sendError
} from "../lib/security.js";

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

function streamPrivateBlob(res, asset, blob) {
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
    if (!token || token.assetId !== assetId || token.ipHash !== ipHash ||
        token.exp < Date.now() || token.exp > Date.now() + 120_000 + 5_000) {
      return sendError(res, 403, "Download link expired or not valid for this file or connection. Verify again.");
    }

    // Resolve the private object before consuming a one-time download slot.
    const blob = await get(asset.pathname, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return sendError(res, 404, "The private file is not available.");
    }

    // Each signed link starts one transfer only. Retrying requires fresh verification
    // and consumes a new slot, so the 3-per-20-second cap cannot be bypassed by cookies.
    const redeemed = await redeemDownloadSlot({ ipHash, nonce: token.nonce });
    if (redeemed.replay) {
      return sendError(res, 409, "This download link has already been used. Verify again.");
    }
    if (!redeemed.allowed) {
      return sendError(res, 429,
        "Download limit reached: at most three download starts per IP in a rolling 20-second window.",
        redeemed.retryMs);
    }

    return streamPrivateBlob(res, asset, blob)
      ? undefined
      : sendError(res, 404, "The private file is not available.");
  } catch (error) {
    console.error("file delivery error:", error?.message || "unknown");
    return sendError(res, 503, "Download service is temporarily unavailable.");
  }
}

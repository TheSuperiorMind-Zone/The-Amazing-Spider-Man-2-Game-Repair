import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "assets.json"), "utf8"));
export const ASSET_MAP = new Map(ASSETS.map((asset) => [asset.id, asset]));

let redisClient;
export function redis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis environment variables are missing.");
  if (!redisClient) redisClient = new Redis({ url, token, enableTelemetry: false });
  return redisClient;
}

export function signingSecret() {
  const value = process.env.TOKEN_HMAC_SECRET || "";
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("TOKEN_HMAC_SECRET must contain at least 32 bytes.");
  }
  return value;
}

export function clientIp(req) {
  // Vercel supplies x-real-ip at its trusted edge. Fall back to the first forwarded address.
  const real = req.headers["x-real-ip"];
  const forwarded = req.headers["x-forwarded-for"];
  const value = (typeof real === "string" && real.trim()) ||
    (typeof forwarded === "string" && forwarded.split(",")[0].trim()) ||
    "";
  if (!value || value.length > 128) throw new Error("Client IP could not be determined.");
  return value;
}

export function hashIp(ip) {
  return crypto.createHmac("sha256", signingSecret()).update("ip:" + ip).digest("hex");
}

export function randomId(bytes = 18) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function proofIsValid(nonce, answer, bits) {
  if (!/^[a-z0-9]{1,32}$/.test(answer)) return false;
  const digest = crypto.createHash("sha256").update(nonce + ":" + answer).digest();
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let i = 0; i < wholeBytes; i++) if (digest[i] !== 0) return false;
  return !remainingBits || (digest[wholeBytes] >> (8 - remainingBits)) === 0;
}

export function signDownload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", signingSecret()).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

export function readDownloadToken(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", signingSecret()).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!value || value.v !== 1 || typeof value.assetId !== "string" ||
        typeof value.ipHash !== "string" || typeof value.nonce !== "string" ||
        !Number.isSafeInteger(value.exp)) return null;
    return value;
  } catch { return null; }
}

const SLIDING_WINDOW_LUA = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = window
  if first[2] then retry = math.max(1, window - (now - tonumber(first[2]))) end
  return {0, count, retry}
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1, 0}
`;

const REDEEM_DOWNLOAD_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {-1, 0, 0}
end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = window
  if first[2] then retry = math.max(1, window - (now - tonumber(first[2]))) end
  return {0, count, retry}
end
redis.call('SET', KEYS[2], '1', 'PX', tonumber(ARGV[3]))
redis.call('SET', KEYS[3], ARGV[5], 'EX', tonumber(ARGV[6]))
redis.call('SET', KEYS[4], '1', 'EX', tonumber(ARGV[6]))
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1, 0}
`;

function normalizeRateResult(result) {
  return {
    allowed: Number(result?.[0]) === 1,
    replay: Number(result?.[0]) === -1,
    count: Number(result?.[1] || 0),
    retryMs: Number(result?.[2] || 0)
  };
}

export async function consumeRedisValue(key) {
  const script = `
local value = redis.call('GET', KEYS[1])
if not value then return false end
redis.call('DEL', KEYS[1])
return value
`;
  return redis().eval(script, [key], []);
}

export async function takeSlidingLimit(key, limit, windowMs) {
  const result = await redis().eval(SLIDING_WINDOW_LUA, [key], [
    windowMs, limit, randomId(12)
  ]);
  return normalizeRateResult(result);
}

export async function redeemDownloadSlot({ ipHash, nonce, sessionId, sessionValue }) {
  const result = await redis().eval(REDEEM_DOWNLOAD_LUA, [
    "download:ip:" + ipHash,
    "download:nonce:" + nonce,
    "download:session:" + sessionId,
    "download:session-requests:" + sessionId
  ], [
    20_000, 3, 120_000, nonce, JSON.stringify(sessionValue), 900
  ]);
  return normalizeRateResult(result);
}

export function parseCookies(req) {
  const result = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

export function parseStoredJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  return res.status(status).json(payload);
}

export function sendError(res, status, message, retryMs = 0) {
  const extra = {};
  if (retryMs > 0) extra["Retry-After"] = String(Math.max(1, Math.ceil(retryMs / 1000)));
  return sendJson(res, status, { error: message }, extra);
}

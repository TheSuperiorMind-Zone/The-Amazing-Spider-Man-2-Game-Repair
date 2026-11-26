/**
 * TSMZ Anti-Bot Download Gateway
 * © Copyright by The Superior Mind-Zone.
 * Independent security component; it does not use the game's source code.
 */
const LIMIT = 12;
const WINDOW = 10 * 60 * 1000;
const DOWNLOAD_LIMIT = 3;
const DOWNLOAD_WINDOW = 20 * 1000;
const TTL = 120;
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "private, no-store, max-age=0"
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      checkConfig(env);
      if (url.hostname.toLowerCase() !== env.ALLOWED_HOSTNAME.toLowerCase()) {
        return text("Unrecognised download host.", 421);
      }
      const assets = getAssets(env);
      if (request.method === "GET" && url.pathname === "/") return html(home(assets), 200);
      if (request.method === "GET" && url.pathname.startsWith("/download/")) {
        const id = decodeURIComponent(url.pathname.slice(10));
        if (!assets[id]) return text("File not found.", 404);
        return html(challenge(id, assets[id], env.TURNSTILE_SITEKEY), 200);
      }
      if (request.method === "POST" && url.pathname === "/verify") return verify(request, env, assets);
      if (request.method === "GET" && url.pathname.startsWith("/file/")) return deliver(request, env, assets);
      return text("Not found.", 404);
    } catch (error) {
      console.error("TSMZ gateway error:", error && error.message ? error.message : String(error));
      return text("The download service is temporarily unavailable.", 500);
    }
  }
};

export class DownloadSentinel {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const input = await request.json().catch(() => null);
    if (!input || !["attempt", "redeem"].includes(input.op) ||
        (input.op === "redeem" && (typeof input.nonce !== "string" || !input.nonce))) {
      return new Response("Bad request", { status: 400 });
    }
    const now = Date.now();
    const result = await this.ctx.storage.transaction(async tx => {
      const old = await tx.get("state");
      const s = old && Array.isArray(old.attempts) && Array.isArray(old.used)
        ? old : { attempts: [], used: [], downloads: [] };
      if (!Array.isArray(s.downloads)) s.downloads = [];
      s.attempts = s.attempts.filter(t => Number.isFinite(t) && t > now - WINDOW);
      s.downloads = s.downloads.filter(t => Number.isFinite(t) && t > now - DOWNLOAD_WINDOW);
      s.used = s.used.filter(x => x && typeof x.nonce === "string" && x.exp > now);
      if (input.op === "attempt") {
        if (s.attempts.length >= LIMIT) {
          await tx.put("state", s);
          return { allowed: false, reason: "rate-limit" };
        }
        s.attempts.push(now);
      } else {
        if (s.used.some(x => x.nonce === input.nonce)) {
          await tx.put("state", s);
          return { allowed: false, reason: "replay" };
        }
        if (s.downloads.length >= DOWNLOAD_LIMIT) {
          await tx.put("state", s);
          return { allowed: false, reason: "download-rate-limit" };
        }
        // Count each accepted one-time download link, not verification attempts.
        // The Durable Object transaction makes simultaneous requests atomic per IP.
        s.downloads.push(now);
        s.used.push({ nonce: input.nonce, exp: now + TTL * 1000 });
      }
      await tx.put("state", s);
      return { allowed: true };
    });
    return json(result, result.allowed ? 200 : result.reason === "replay" ? 409 : 429);
  }
}

async function verify(request, env, assets) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return text("Connection could not be verified.", 400);
  const form = await request.formData();
  const id = String(form.get("asset") || "");
  const responseToken = String(form.get("cf-turnstile-response") || "");
  if (!assets[id] || !responseToken || responseToken.length > 2048) {
    return html(message("Verification failed", "Return to the download page and try again."), 400);
  }
  const rate = await checkRate(env, ip, "attempt", "");
  if (!rate.allowed) return html(message("Too many attempts", "Please wait before trying again."), 429);

  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", responseToken);
  body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body
  });
  if (!res.ok) return html(message("Verification unavailable", "Please try again later."), 502);
  const verdict = await res.json();
  const valid = verdict.success === true &&
    verdict.hostname === env.ALLOWED_HOSTNAME &&
    verdict.action === "download" &&
    verdict.cdata === id;
  if (!valid) return html(message("Verification not accepted", "Reload the page and complete the security check again."), 403);

  const payload = {
    v: 1, id: id, exp: Math.floor(Date.now() / 1000) + TTL,
    nonce: randomId(), ipTag: await hmac(env.TOKEN_HMAC_SECRET, "ip:" + ip)
  };
  const token = await sign(payload, env.TOKEN_HMAC_SECRET);
  const link = "/file/" + encodeURIComponent(id) + "?token=" + encodeURIComponent(token);
  return html(ready(assets[id].filename, link), 200);
}

async function deliver(request, env, assets) {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.slice(6));
  const asset = assets[id];
  if (!asset) return text("File not found.", 404);
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return text("Connection could not be verified.", 400);
  const payload = await unsign(url.searchParams.get("token") || "", env.TOKEN_HMAC_SECRET);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.v !== 1 || payload.id !== id || !payload.nonce ||
      payload.exp < now || payload.exp > now + TTL + 5) {
    return html(message("Download link expired", "Return to the download page and verify again."), 403);
  }
  const ipTag = await hmac(env.TOKEN_HMAC_SECRET, "ip:" + ip);
  if (!same(payload.ipTag || "", ipTag)) {
    return html(message("Download link not valid", "This link belongs to a different connection. Verify again."), 403);
  }
  // Check storage before consuming a download slot, so a missing object is not counted.
  const object = await env.FILES.get(asset.key);
  if (!object) return text("The requested file is not available.", 404);
  const rate = await checkRate(env, ip, "redeem", payload.nonce);
  if (!rate.allowed) {
    const detail = rate.reason === "replay"
      ? "This link has already been used. Verify again for a new link."
      : "Download limit reached: up to three downloads per IP in a rolling 20-second window. Please wait before trying again.";
    return html(message("Download blocked", detail), rate.reason === "replay" ? 409 : 429);
  }
  const headers = new Headers(HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", asset.contentType);
  headers.set("Content-Disposition", 'attachment; filename="' + safeName(asset.filename) + '"');
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function checkRate(env, ip, op, nonce) {
  const key = await sha256(ip);
  const id = env.SENTINEL.idFromName(key);
  const stub = env.SENTINEL.get(id);
  const res = await stub.fetch("https://sentinel/check", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, nonce: nonce || "" })
  });
  const data = await res.json().catch(() => ({}));
  return { allowed: res.ok && data.allowed === true, reason: data.reason || "rate-limit" };
}

function checkConfig(env) {
  if (!env.ALLOWED_HOSTNAME || !/^[a-z0-9.-]+$/i.test(env.ALLOWED_HOSTNAME)) throw new Error("Invalid ALLOWED_HOSTNAME");
  if (!env.TURNSTILE_SITEKEY || env.TURNSTILE_SITEKEY.startsWith("REPLACE_")) throw new Error("Turnstile site key is not configured");
  if (!env.TURNSTILE_SECRET || env.TURNSTILE_SECRET.length < 10) throw new Error("Turnstile secret is not configured");
  if (!env.TOKEN_HMAC_SECRET || env.TOKEN_HMAC_SECRET.length < 32) throw new Error("Token signing secret is not configured");
  if (!env.FILES || !env.SENTINEL) throw new Error("R2 or Durable Object binding is missing");
}
function getAssets(env) {
  const assets = JSON.parse(env.ASSETS_JSON || "{}");
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) throw new Error("Invalid asset allow-list");
  for (const [id, a] of Object.entries(assets)) {
    if (!/^[a-z0-9-]{2,48}$/.test(id) || !a ||
        typeof a.key !== "string" || !a.key.startsWith("protected/") ||
        a.key.includes("..") || a.key.includes("\\") ||
        typeof a.filename !== "string" || typeof a.label !== "string" ||
        typeof a.contentType !== "string") throw new Error("Invalid asset mapping: " + id);
  }
  return assets;
}
async function sign(payload, secret) {
  const data = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return data + "." + b64url(await hmacBytes(secret, data));
}
async function unsign(token, secret) {
  if (!token || token.length > 2048) return null;
  const p = token.split(".");
  if (p.length !== 2) return null;
  try {
    const expected = await hmacBytes(secret, p[0]);
    if (!sameBytes(expected, unb64url(p[1]))) return null;
    return JSON.parse(new TextDecoder().decode(unb64url(p[0])));
  } catch (_) { return null; }
}
async function hmac(secret, data) { return b64url(await hmacBytes(secret, data)); }
async function hmacBytes(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
async function sha256(data) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(s) {
  const v = s.replace(/-/g, "+").replace(/_/g, "/");
  const b = atob(v + "=".repeat((4 - v.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
function same(a, b) { return sameBytes(new TextEncoder().encode(a), new TextEncoder().encode(b)); }
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function randomId() { return b64url(crypto.getRandomValues(new Uint8Array(18))); }
function safeName(s) { return s.replace(/[\r\n"\\]/g, "_").slice(0, 160); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function shell(title, body) {
  const css = "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#090f1c;color:#eef3fb;font:16px Segoe UI,Arial}main{width:min(680px,100%);box-sizing:border-box;padding:30px;background:#111c2e;border:1px solid #263a59;border-radius:18px}h1{font-size:30px}p{line-height:1.55;color:#bdcbe0}.asset,.notice{padding:15px;margin:14px 0;background:#0c1524;border:1px solid #293d5b;border-radius:10px}.button{display:inline-block;background:#cf1e32;color:white;text-decoration:none;border:0;border-radius:8px;padding:12px 18px;font-weight:700;cursor:pointer}.footer{border-top:1px solid #2a3a52;margin-top:24px;padding-top:16px;font-size:12px;color:#8fa4c2}.sub{font-size:13px;color:#8fa4c2}.cf-turnstile{margin:18px 0}";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>' +
    esc(title) + '</title><style>' + css + '</style></head><body><main>' + body +
    '<div class="footer">© Copyright by The Superior Mind-Zone. · TSMZ Download Protection</div></main></body></html>';
}
function home(assets) {
  let cards = "";
  for (const [id, a] of Object.entries(assets)) {
    cards += '<div class="asset"><strong>' + esc(a.label) + '</strong><p class="sub">Human verification required.</p><a class="button" href="/download/' + encodeURIComponent(id) + '">Download</a></div>';
  }
  return shell("TSMZ Protected Downloads", "<h1>TSMZ Protected Downloads</h1><p>Choose a file and complete a short security check before downloading.</p>" +
    (cards || '<div class="notice">No files are configured.</div>') +
    '<p class="sub">Files are served from private storage, not directly from GitHub.</p>');
}
function challenge(id, a, sitekey) {
  return shell("Verify to download", '<h1>Verify before downloading</h1><p>You requested:</p><div class="asset"><strong>' +
    esc(a.filename) + '</strong></div><form method="POST" action="/verify"><input type="hidden" name="asset" value="' +
    esc(id) + '"><div class="cf-turnstile" data-sitekey="' + esc(sitekey) +
    '" data-action="download" data-cdata="' + esc(id) + '"></div><button class="button" type="submit">Verify and continue</button></form>' +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><p class="sub">The link expires after two minutes, is tied to your connection, and can only be used once.</p>');
}
function ready(filename, link) {
  return shell("Download ready", '<h1>Your download is ready</h1><div class="notice">Security check passed.</div><p>' +
    esc(filename) + '</p><a class="button" href="' + esc(link) + '">Download file</a><p class="sub">The link expires after two minutes and works once.</p>');
}
function message(title, detail) {
  return shell(title, '<h1>' + esc(title) + '</h1><div class="notice">' + esc(detail) +
    '</div><a class="button" href="/">Return to downloads</a>');
}
function html(body, status) {
  const h = new Headers(HEADERS);
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(body, { status, headers: h });
}
function text(body, status) {
  const h = new Headers(HEADERS); h.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers: h });
}
function json(body, status) {
  const h = new Headers(HEADERS); h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}

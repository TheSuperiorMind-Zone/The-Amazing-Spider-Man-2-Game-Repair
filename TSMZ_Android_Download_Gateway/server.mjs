/**
 * TSMZ Android Download Gateway
 * © Copyright by The Superior Mind-Zone.
 * Independent gateway; it does not use the game's source code.
 * Node.js built-ins only. Designed to run locally on Android/Termux.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(ROOT, 'protected-files');
const ASSETS_PATH = path.join(ROOT, 'assets.json');
const SECRET_PATH = path.join(ROOT, '.token-secret');
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const TOKEN_TTL_SECONDS = 120;
const SESSION_TTL_SECONDS = 15 * 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 12;
const POW_BITS = 14;
const MAX_SESSION_REQUESTS = 20;
const MAX_BODY_BYTES = 4096;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store, max-age=0',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function loadAssets() {
  const raw = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('assets.json must contain an asset array.');
  const result = new Map();
  for (const item of raw) {
    if (!item || !/^[a-z0-9-]{2,48}$/.test(item.id) ||
        typeof item.filename !== 'string' || path.basename(item.filename) !== item.filename ||
        !Number.isSafeInteger(item.size) || item.size <= 0 ||
        !/^[a-f0-9]{40}$/.test(item.gitBlobSha1) || result.has(item.id)) {
      throw new Error('Invalid asset entry in assets.json.');
    }
    const fullPath = path.join(FILES_DIR, item.filename);
    const bytes = fs.readFileSync(fullPath);
    if (bytes.length !== item.size) throw new Error(`Size mismatch for ${item.filename}.`);
    const digest = crypto.createHash('sha1')
      .update(`blob ${bytes.length}\0`, 'utf8')
      .update(bytes)
      .digest('hex');
    if (digest !== item.gitBlobSha1) throw new Error(`Git object hash mismatch for ${item.filename}.`);
    result.set(item.id, Object.freeze({ ...item, fullPath }));
  }
  return result;
}

function loadSecret() {
  if (fs.existsSync(SECRET_PATH)) {
    const value = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('The local token secret is invalid. Remove .token-secret and restart to regenerate it.');
    return value;
  }
  const value = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, `${value}\n`, { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(SECRET_PATH, 0o600); } catch { /* Android filesystem may ignore POSIX mode bits. */ }
  return value;
}

const assets = loadAssets();
const tokenSecret = loadSecret();
const challenges = new Map();
const usedNonces = new Map();
const sessions = new Map();
const challengeRateBuckets = new Map();
const verifyRateBuckets = new Map();
teBuckets = new Map();
const verifyRateBuckets = new Map();

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function signPayload(payload) {
  const encoded = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', tokenSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
function readToken(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', tokenSecret).update(parts[0]).digest('base64url');
  if (!safeEqual(expected, parts[1])) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!value || value.v !== 1 || typeof value.asset !== 'string' ||
        typeof value.ipKey !== 'string' || typeof value.nonce !== 'string' ||
        !Number.isInteger(value.exp)) return null;
    return value;
  } catch { return null; }
}
function clientIp(req) {
  // The service is bound to loopback and is intended to be reached only through an SSH tunnel.
  // The tunnel provider supplies X-Forwarded-For. Its value is used only as a rate-limit key.
  const forwarded = req.headers['x-forwarded-for'];
  const candidate = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const value = candidate || req.socket.remoteAddress || 'unknown';
  return crypto.createHmac('sha256', tokenSecret).update(`ip:${value}`).digest('hex');
}
function rateAllowed(bucket, ipKey) {
  const now = Date.now();
  const recent = (bucket.get(ipKey) || []).filter(t => t > now - RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    bucket.set(ipKey, recent);
    return false;
  }
  recent.push(now);
  bucket.set(ipKey, recent);
  return true;
}
function pruneMaps() {
  const now = Date.now();
  for (const [key, value] of challenges) if (value.exp < now || value.used) challenges.delete(key);
  for (const [key, value] of usedNonces) if (value < now) usedNonces.delete(key);
  for (const [key, value] of sessions) if (value.exp < now || value.requests >= MAX_SESSION_REQUESTS) sessions.delete(key);
  for (const bucket of [challengeRateBuckets, verifyRateBuckets]) {
    for (const [key, values] of bucket) {
      const recent = values.filter(t => t > now - RATE_WINDOW_MS);
      if (recent.length) bucket.set(key, recent); else bucket.delete(key);
    }
  }
}
function send(res, status, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType, ...extra });
  res.end(body);
}
function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function page(title, body) {
  const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  return {
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>
      :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:#090f1c;color:#edf3fb;font:16px system-ui,Segoe UI,Arial}main{width:min(720px,100%);padding:28px;background:#111c2e;border:1px solid #293b58;border-radius:16px}h1{font-size:26px;margin:0 0 12px}p{line-height:1.55;color:#bdcbe0}.asset{margin:14px 0;padding:16px;border:1px solid #2b405f;border-radius:10px;background:#0b1525}.button{display:inline-block;padding:12px 18px;border:0;border-radius:8px;background:#c82035;color:white;font-weight:700;text-decoration:none;cursor:pointer}.button:disabled{opacity:.55;cursor:wait}.muted{font-size:13px;color:#92a6c2}.footer{margin-top:24px;padding-top:15px;border-top:1px solid #2a3b55;color:#91a3bd;font-size:12px}#status{min-height:24px;margin:12px 0;color:#d8e2f0}
      </style></head><body><main>${body}<div class="footer">© Copyright by The Superior Mind-Zone · TSMZ Android Download Gateway</div></main></body></html>`,
    csp,
  };
}
function sendPage(res, title, body, status = 200) {
  const result = page(title, body);
  send(res, status, result.body, 'text/html; charset=utf-8', { 'Content-Security-Policy': result.csp });
}
function homePage() {
  const rows = [...assets.values()].map(asset => `<div class="asset"><strong>${escapeHtml(asset.label)}</strong><p class="muted">${escapeHtml(asset.filename)} · ${asset.size.toLocaleString('en-US')} bytes</p><a class="button" href="/download/${encodeURIComponent(asset.id)}">Open protected download</a></div>`).join('');
  return `<h1>TSMZ Protected Downloads</h1><p>Select a file, complete the lightweight browser security challenge, then download it.</p>${rows}<p class="muted">Automated clients may still solve browser challenges. Rate limits and short-lived links reduce abuse but do not guarantee that every bot is blocked.</p>`;
}
function challengePage(asset) {
  return `<h1>Security check</h1><p>Requested file:</p><div class="asset"><strong>${escapeHtml(asset.filename)}</strong></div><p>Press the button to run a short browser proof-of-work challenge. No account is required.</p><button id="verify" class="button" type="button">Verify and continue</button><p id="status" role="status" aria-live="polite"></p><p class="muted">The verification link expires after two minutes, is tied to this connection, and can be redeemed once. The download session then remains available briefly for browser range/retry requests.</p><script>
      const asset=${JSON.stringify(asset.id)};
      const button=document.getElementById('verify');
      const status=document.getElementById('status');
      const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
      button.addEventListener('click',async()=>{
        button.disabled=true;status.textContent='Preparing security check…';
        try{
          if(!globalThis.crypto?.subtle)throw new Error('This browser does not support secure verification. Open the HTTPS link in a modern browser.');
          const start=await fetch('/api/challenge?asset='+encodeURIComponent(asset),{cache:'no-store'});
          const challenge=await start.json();
          if(!start.ok)throw new Error(challenge.error||'Could not start verification.');
          const encoder=new TextEncoder();let answer=0;let found=false;
          while(answer<5000000){
            const candidate=answer.toString(36);
            const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(challenge.nonce+':'+candidate)));
            const wholeBytes=Math.floor(challenge.bits/8);
            const remainingBits=challenge.bits%8;
            let good=true;
            for(let i=0;i<wholeBytes;i++)if(digest[i]!==0)good=false;
            if(remainingBits&&(digest[wholeBytes]>>(8-remainingBits))!==0)good=false;
            if(good){found=true;break;}
            answer++;
            if(answer%256===0){status.textContent='Checking browser… '+answer.toLocaleString()+' attempts';await wait(0);}
          }
          if(!found)throw new Error('The security challenge could not be completed. Please reload and retry.');
          status.textContent='Verification passed. Preparing download…';
          const result=await fetch('/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset,challengeId:challenge.challengeId,answer:answer.toString(36)})});
          const verdict=await result.json();
          if(!result.ok)throw new Error(verdict.error||'Verification was rejected.');
          location.assign(verdict.downloadUrl);
        }catch(error){status.textContent=error.message||'Verification failed.';button.disabled=false;}
      });
    </script>`;
}
async function readJson(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) throw new Error('Expected JSON request.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createChallenge(req, res, url) {
  const id = url.searchParams.get('asset') || '';
  if (!assets.has(id)) return sendJson(res, 404, { error: 'File not found.' });
  const ipKey = clientIp(req);
  if (!rateAllowed(challengeRateBuckets, ipKey)) return sendJson(res, 429, { error: 'Too many challenge requests. Please wait ten minutes before trying again.' });
  pruneMaps();
  const challengeId = crypto.randomBytes(18).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('hex');
  const exp = Date.now() + TOKEN_TTL_SECONDS * 1000;
  challenges.set(challengeId, { asset: id, nonce, ipKey, exp, used: false, failures: 0 });
  sendJson(res, 200, { challengeId, nonce, bits: POW_BITS, expiresAt: exp });
}
async function verifyChallenge(req, res) {
  let input;
  try { input = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message || 'Invalid request.' }); }
  const challengeId = String(input.challengeId || '');
  const answer = String(input.answer || '');
  const id = String(input.asset || '');
  const challenge = challenges.get(challengeId);
  const ipKey = clientIp(req);
  if (!rateAllowed(verifyRateBuckets, ipKey)) return sendJson(res, 429, { error: 'Too many verification attempts. Please wait ten minutes before trying again.' });
  if (!challenge || challenge.used || challenge.exp < Date.now() || challenge.asset !== id || challenge.ipKey !== ipKey || !assets.has(id) || !/^[a-z0-9]{1,32}$/.test(answer)) {
    return sendJson(res, 403, { error: 'Challenge expired or not valid for this connection. Return and try again.' });
  }
  const digest = crypto.createHash('sha256').update(`${challenge.nonce}:${answer}`).digest();
  const fullBytes = Math.floor(POW_BITS / 8);
  const remainingBits = POW_BITS % 8;
  let valid = true;
  for (let i = 0; i < fullBytes; i++) if (digest[i] !== 0) valid = false;
  if (remainingBits && (digest[fullBytes] >> (8 - remainingBits)) !== 0) valid = false;
  if (!valid) {
    challenge.failures++;
    if (challenge.failures >= 3) challenge.used = true;
    return sendJson(res, 403, { error: 'The browser proof was not accepted. Try again.' });
  }
  challenge.used = true;
  const token = signPayload({ v: 1, asset: id, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS, nonce: crypto.randomBytes(18).toString('base64url'), ipKey });
  sendJson(res, 200, { downloadUrl: `/file/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}` });
}
function parseCookies(req) {
  const result = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}
function getSession(req, id, ipKey) {
  const sessionId = parseCookies(req)[`tsmzdl_${id}`];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || session.asset !== id || session.ipKey !== ipKey || session.exp < Date.now() || session.requests >= MAX_SESSION_REQUESTS) return null;
  return session;
}
function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start; let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}
function streamAsset(req, res, asset, session, setCookie) {
  const stat = fs.statSync(asset.fullPath);
  const range = parseRange(req.headers.range, stat.size);
  if (range === false) return send(res, 416, 'Requested range is not satisfiable.', 'text/plain; charset=utf-8', { 'Content-Range': `bytes */${stat.size}` });
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': asset.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${asset.filename.replace(/[\r\n"\\]/g, '_')}"`,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  if (setCookie) {
    const isHttps = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https' || Boolean(req.socket.encrypted);
    headers['Set-Cookie'] = `tsmzdl_${asset.id}=${setCookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${isHttps ? '; Secure' : ''}`;
  }
  session.requests++;
  res.writeHead(range ? 206 : 200, headers);
  const file = fs.createReadStream(asset.fullPath, { start, end });
  file.on('error', () => { if (!res.headersSent) res.writeHead(500); res.destroy(); });
  file.pipe(res);
}
function deliver(req, res, id, url) {
  const asset = assets.get(id);
  if (!asset) return send(res, 404, 'File not found.');
  const ipKey = clientIp(req);
  let session = getSession(req, id, ipKey);
  let newSessionId = null;
  if (!session) {
    const token = readToken(url.searchParams.get('token') || '');
    const now = Math.floor(Date.now() / 1000);
    if (!token || token.asset !== id || token.ipKey !== ipKey || token.exp < now || token.exp > now + TOKEN_TTL_SECONDS + 5) {
      return send(res, 403, 'Download link expired or not valid for this connection. Return to the download page and verify again.');
    }
    if (usedNonces.has(token.nonce)) return send(res, 409, 'This download link has already been redeemed. Verify again.');
    usedNonces.set(token.nonce, Date.now() + SESSION_TTL_SECONDS * 1000);
    newSessionId = crypto.randomBytes(32).toString('base64url');
    session = { asset: id, ipKey, exp: Date.now() + SESSION_TTL_SECONDS * 1000, requests: 0 };
    sessions.set(newSessionId, session);
  }
  streamAsset(req, res, asset, session, newSessionId);
}
function route(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') return sendPage(res, 'TSMZ Protected Downloads', homePage());
  if (req.method === 'GET' && url.pathname.startsWith('/download/')) {
    const id = decodeURIComponent(url.pathname.slice('/download/'.length));
    const asset = assets.get(id);
    return asset ? sendPage(res, 'Verify to download', challengePage(asset)) : send(res, 404, 'File not found.');
  }
  if (req.method === 'GET' && url.pathname === '/api/challenge') return createChallenge(req, res, url);
  if (req.method === 'POST' && url.pathname === '/api/verify') return verifyChallenge(req, res);
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/file/')) {
    const id = decodeURIComponent(url.pathname.slice('/file/'.length));
    if (req.method === 'HEAD') return send(res, 405, 'Method not allowed.');
    return deliver(req, res, id, url);
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/stream/')) {
    const id = decodeURIComponent(url.pathname.slice('/stream/'.length));
    const asset = assets.get(id);
    if (!asset) return send(res, 404, 'File not found.');
    const session = getSession(req, id, clientIp(req));
    if (!session) return send(res, 403, 'Download session expired. Verify again.');
    if (req.method === 'HEAD') return send(res, 200, '', asset.contentType || 'application/octet-stream', { 'Content-Length': String(fs.statSync(asset.fullPath).size) });
    return streamAsset(req, res, asset, session, null);
  }
  return send(res, 404, 'Not found.');
}

const server = http.createServer((req, res) => {
  try {
    const result = route(req, res);
    if (result && typeof result.then === 'function') result.catch(() => {
      if (!res.headersSent) send(res, 500, 'The download service encountered an internal error.');
      else res.destroy();
    });
  } catch (error) {
    console.error(`Gateway request error: ${error?.message || 'unknown error'}`);
    if (!res.headersSent) send(res, 500, 'The download service encountered an internal error.');
    else res.destroy();
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => {
  console.log('TSMZ Android Download Gateway');
  console.log(`Listening only on http://${HOST}:${PORT}`);
  console.log(`Verified assets: ${assets.size}`);
  console.log('No game source code is used.');
  console.log('Keep this process running while the SSH tunnel is active.');
});
server.on('error', error => {
  console.error(`Gateway could not start: ${error.message}`);
  process.exitCode = 1;
});

# TSMZ Anti-Bot Download Gateway

© Copyright by The Superior Mind-Zone.

This is an independent Cloudflare Worker download gateway. It uses Cloudflare Turnstile, a private R2 bucket, short-lived signed download tokens, IP binding, and a SQLite-backed Durable Object rate/replay guard. It does not use or copy the game's source code.

## Important: staged, not active

The GitHub repository is public. A Worker cannot intercept direct GitHub downloads, Git clones, GitHub ZIPs, Git blob URLs, raw URLs, or public release assets.

Protection only becomes effective after:
1. Deploying this Worker on a custom download hostname.
2. Uploading all mapped files to a private R2 bucket.
3. Configuring Turnstile and Worker secrets.
4. Testing the complete download path.
5. Retiring public GitHub copies and addressing old history references.
6. Replacing public GitHub download links with the gateway URLs.

Until cutover, the current public GitHub files remain downloadable directly.

## Covered files

Crash.rar; Hook.zip; Note 3.jpg; Proof Video.rar; Scanner.rar; Systems.zip; The Amazing Spider-Man 2 - 4K Render Tool.rar.

The allow-list and R2 object keys are in wrangler.toml.

## Protections

- Server-side Turnstile Siteverify. Requires success, the expected hostname, action=download, and matching cdata asset ID.
- Fail-closed configuration: missing keys, secrets, R2 binding, or Sentinel binding prevents service.
- Signed links expire after 120 seconds.
- Links are bound to the IP that passed verification and are single-use.
- Download-start limit: at most 3 accepted one-time download-link redemptions per IP in any rolling 20-second window, shared across all listed files and enforced atomically by the Durable Object.
- Verification-attempt limit: 12 attempts per IP in a rolling 10-minute window.
- A download slot is consumed only after the signed link and stored object are valid. Replayed links are rejected separately. The quota counts accepted download starts; it does not measure whether the visitor finished saving the entire file.
- Durable Object names use a SHA-256 digest of the IP.
- Only the explicit R2 allow-list can be downloaded.
- R2 must remain private; never publish direct R2 object URLs.

No system guarantees that all automated clients will be blocked. Browser automation, distributed IP addresses, and human-solving services remain possible.

## Deploy

Prerequisites: Cloudflare Workers, Durable Objects, Turnstile, R2, a custom hostname, Node.js, and Wrangler 4.

1. Create a Turnstile widget for the intended download hostname.
2. Set ALLOWED_HOSTNAME and TURNSTILE_SITEKEY in wrangler.toml.
3. Create the private bucket:
   ```sh
   npx wrangler login
   npx wrangler r2 bucket create tsmz-private-downloads
   ```
4. Upload each current repository file under the object key in ASSETS_JSON, in the protected/ prefix.
5. Set secrets:
   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put TOKEN_HMAC_SECRET
   ```
   TOKEN_HMAC_SECRET must be a fresh random value of at least 32 characters. Never commit secrets.
6. Install, check, and deploy:
   ```sh
   npm install
   npm run check
   npm run deploy
   ```
7. Attach the custom hostname. Its hostname must match ALLOWED_HOSTNAME and the Turnstile widget.

## Test before cutover

- Invalid asset IDs are rejected.
- Direct /file requests without a signed token are rejected.
- Invalid Turnstile tokens and wrong hostname/action/cdata are rejected.
- Links expire after two minutes.
- Cross-IP use and replays are rejected.
- A fourth valid download-link redemption by the same IP within a rolling 20-second window is rejected with HTTP 429, including requests for different files.
- After the oldest download leaves the 20-second window, another download is allowed.
- A missing R2 object does not consume a download slot.
- Concurrent redemptions are serialized by the Durable Object transaction.
- More than 12 verification attempts in 10 minutes are rate-limited.
- R2 objects have no public access.
- Downloaded files match original SHA-256 hashes.

Removing a file from the current branch does not erase old copies from Git history. A history rewrite or clean-repository migration may be required and must be planned separately because it changes commit SHAs and can disrupt existing clones and forks.

## Privacy

The Worker sends the connecting IP to Turnstile and uses it for rate limiting and token binding. Publish a privacy notice before opening downloads to visitors. Do not log secrets, tokens, or raw IP addresses.

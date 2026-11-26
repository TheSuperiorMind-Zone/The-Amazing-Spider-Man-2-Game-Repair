# TSMZ Vercel Private Download Gateway

© Copyright by The Superior Mind-Zone.

This independent download gateway is designed for Vercel serverless functions, private Vercel Blob storage, and Upstash Redis. It does not use the game's source code and does not require Cloudflare, an always-running phone, or a self-managed server.

## Status: prepared, not active

The code is prepared in this directory, but it is not deployed or connected to Vercel/Upstash. All seven existing GitHub files remain public until the owner completes a separate source-visibility cutover. Direct GitHub Raw, Blob, ZIP, clone, and historical commit URLs bypass this gateway while the repository remains public.

## Exact download policy

- At most **3 accepted download starts per client IP in a rolling 20-second window**, across all seven assets.
- The fourth valid download start from that IP is rejected with HTTP 429 and a Retry-After value.
- The limit uses an atomic Upstash Redis Lua transaction, so simultaneous requests cannot race past the cap.
- Verification attempts have a separate limit of 12 per IP in a rolling 10-minute window.
- A successful browser proof-of-work challenge produces a signed HMAC link valid for 120 seconds and bound to the verified IP.
- Each signed link is single-use and starts exactly one transfer. Retrying or restarting requires a new verification and consumes another download slot; the initial implementation deliberately does not support HTTP Range/resume.
- Rate-limit state is shared in Redis, so serverless cold starts and parallel function instances do not reset the policy.
- The seven assets are read only from private Vercel Blob storage. No public Blob URL is emitted.
- Raw client IPs are not stored. A keyed HMAC digest is used as the Redis key.

The proof-of-work challenge raises the cost of automated requests but is not a human CAPTCHA. A bot with sufficient compute or a solver can still pass. The download limit applies per IP, so users behind the same NAT/VPN share the same three-download allowance.

## Services and free-tier suitability

- Vercel Hobby: serverless functions and static hosting. No phone, VPS process, or 24/7 SSH session must be kept alive. Hobby is intended for personal, non-commercial use and pauses when free usage limits are exceeded.
- Vercel Blob private store (currently documented as Beta): 1 GB included storage and the first 10 GB of Blob transfer on Hobby. Private objects are streamed through authenticated Functions and their delivery also consumes function/CDN transfer. The seven source files total about 28.7 MB, so they fit comfortably in the included storage. Vercel recommends keeping private-storage delivery for files below 100 MB when traffic is low.
- Upstash Redis Free: 250 MB data, 500,000 commands per month, and 10 GB monthly bandwidth.

These are usage allowances, not an uptime SLA or an unlimited-download guarantee. When free quotas are exceeded, access may pause until the quota resets or the plan changes. Check the current dashboard limits before public launch.

## Setup

### 1. Create the two free accounts

1. Create a Vercel account at https://vercel.com/signup and connect the authorised GitHub account.
2. Create an Upstash account at https://upstash.com/ and create a Redis database. Select a nearby region if available.
3. On Vercel, import this repository and set the **Root Directory** to `TSMZ_Vercel_Download_Gateway`.
4. Deploy the project once. This creates its Vercel HTTPS URL.

### 2. Add private Blob storage

1. In the Vercel project, open Storage and create a **Private** Blob store. Do not choose Public.
2. Connect the store to this project so `BLOB_READ_WRITE_TOKEN` is available in the deployment environment.

### 3. Connect Upstash Redis

1. Connect the Upstash database to the Vercel project using the Upstash integration, or add its REST credentials as project environment variables.
2. The required variables are `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### 4. Set the signing secret

Generate a fresh secret locally:
```sh
openssl rand -hex 32
```
Add the result to Vercel as `TOKEN_HMAC_SECRET`. Never commit the secret or send it in chat.

### 5. Upload the seven existing files to private storage

The upload script reads the original files from the repository root, verifies each exact byte count and Git blob SHA-1 before upload, then reads each private Blob back through the authenticated SDK and checks its full size and Git blob SHA-1 again.

On a computer or in Termux with Node.js:
```sh
cd TSMZ_Vercel_Download_Gateway
npm install
```

Link the local folder to the Vercel project and pull its environment variables:
```sh
npm install -g vercel
vercel login
vercel link
vercel env pull .env.local
```

Then upload:
```sh
npm run migrate:assets
```

Do not share `.env.local`. It contains private credentials.

### 6. Redeploy and test

After all three environment variables and all seven private blobs are ready, redeploy from Vercel. Test:
- all seven cards render;
- each file passes browser proof-of-work;
- the first three download starts from the same IP succeed;
- the fourth is rejected with HTTP 429;
- after the oldest accepted start leaves the rolling 20-second window, another download succeeds;
- a different IP has a separate counter;
- replaying a token is rejected;
- private Blob paths cannot be fetched without the gateway;
- a download link cannot be reused from a different IP.

## Critical GitHub bypass issue

**This service cannot enforce its limit on direct GitHub URLs.** The GitHub repository currently contains all seven files publicly, and their direct download URLs bypass this serverless gateway.

To apply the 3/20 limit to all public downloads, the owner must choose a source cutover after the Vercel download tests pass:
- make this existing repository private, preserving its current files and history but hiding the whole repository from the public; or
- remove the public asset copies and clean their reachable Git history, with the remaining public-cache/fork caveats.

Do not claim full protection while public direct copies remain available. No file deletion, repository visibility change, or history rewrite is performed by this project.

## Operational limits

- Vercel Hobby functions can time out; this gateway configures a 60-second function duration. Very slow or interrupted downloads may need to be restarted.
- Private Blob delivery consumes both Blob transfer and function response transfer.
- The free service has no uptime SLA and can pause at its usage limits.
- A proof-of-work challenge is not a CAPTCHA and does not stop all bots.
- This gateway counts accepted download starts, not completed bytes. Range/resume support is not enabled by this initial implementation.

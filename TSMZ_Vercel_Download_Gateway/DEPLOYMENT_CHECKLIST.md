# Vercel Gateway Deployment Checklist

© Copyright by The Superior Mind-Zone.

## Accounts and deployment
- [ ] Create Vercel Hobby account and connect the authorised GitHub repository.
- [ ] Create Upstash Redis Free database.
- [ ] Import the repository with Root Directory `TSMZ_Vercel_Download_Gateway`.
- [ ] Create a **Private** Vercel Blob store and connect it to the project.
- [ ] Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- [ ] Add a fresh `TOKEN_HMAC_SECRET` of at least 32 bytes.
- [ ] Deploy the Vercel project.

## Asset migration
- [ ] Run `npm install` locally.
- [ ] Run `vercel link` and `vercel env pull .env.local`.
- [ ] Run `npm run migrate:assets`.
- [ ] Confirm all seven files passed exact size and Git blob SHA-1 checks.
- [ ] Confirm all seven files are in private Blob storage, not public Blob storage.

## Download tests
- [ ] All seven assets appear in the public gateway page.
- [ ] Invalid asset ID returns 404.
- [ ] A missing, invalid, expired, or cross-IP token is rejected.
- [ ] A token cannot be redeemed twice.
- [ ] Three accepted download starts from one IP within a rolling 20 seconds succeed.
- [ ] The fourth accepted-start attempt within that window returns HTTP 429.
- [ ] The limit is shared across all seven assets.
- [ ] Another IP has an independent quota.
- [ ] After the oldest accepted start leaves the window, a new download is accepted.
- [ ] Reusing a consumed signed link is rejected with HTTP 409, including after the first transfer completes or disconnects.
- [ ] Direct private Blob URL access is rejected.
- [ ] No private storage tokens or HMAC secrets are exposed to the browser.

## Public-source cutover — not performed
- [ ] Confirm Vercel tests from a second device/network.
- [ ] Decide whether to make the existing repository private or clean public binary history.
- [ ] Confirm how the public project README/docs remain accessible.
- [ ] Only after approval, retire direct public GitHub copies and old download links.
- [ ] Re-test old Raw, blob, archive, clone and commit paths.
- [ ] Publish the Vercel gateway URL as the only supported public download location.

**Current status: source prepared only.** No Cloudflare deployment, account connection, Vercel deployment, Upstash database, Blob migration, file deletion, repository visibility change, or public cutover has been performed.

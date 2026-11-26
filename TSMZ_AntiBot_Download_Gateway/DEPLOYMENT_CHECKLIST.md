# Deployment Checklist

© Copyright by The Superior Mind-Zone.

## Cloudflare
- [ ] Create Turnstile widget for final download hostname.
- [ ] Set ALLOWED_HOSTNAME and TURNSTILE_SITEKEY.
- [ ] Create private R2 bucket tsmz-private-downloads.
- [ ] Upload all seven allow-listed files to the exact protected/ keys.
- [ ] Confirm R2 public access is disabled.
- [ ] Set TURNSTILE_SECRET as a Worker secret.
- [ ] Set fresh TOKEN_HMAC_SECRET (32+ characters).
- [ ] Run npm install and npm run check.
- [ ] Deploy with npm run deploy.
- [ ] Attach the custom hostname.

## Security tests
- [ ] Unknown asset returns 404.
- [ ] Invalid Turnstile token is rejected.
- [ ] Wrong hostname/action/cdata is rejected.
- [ ] Unsigned or expired link is rejected.
- [ ] Cross-IP link use is rejected.
- [ ] Replayed link is rejected.
- [ ] More than 12 attempts in 10 minutes are blocked.
- [ ] R2 files have no public URL.
- [ ] Downloaded files match original SHA-256.

## GitHub cutover — not performed
- [ ] Verify all private R2 uploads and hashes.
- [ ] Remove matching public files only after successful R2 tests.
- [ ] Review old Git history, tags, releases, forks, cached/raw URLs and commit URLs.
- [ ] Plan any history rewrite or clean-repository migration separately.
- [ ] Replace all public download links with the gateway.
- [ ] Confirm no direct public GitHub copies remain.
- [ ] Publish a privacy notice.

Current status: gateway source/configuration is prepared but not deployed. Existing GitHub assets remain public.

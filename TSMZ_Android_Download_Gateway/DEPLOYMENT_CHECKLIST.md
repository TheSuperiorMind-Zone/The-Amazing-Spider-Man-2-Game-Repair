# OPPO A54 Gateway Deployment Checklist

© Copyright by The Superior Mind-Zone.

## Install on the phone
- [ ] Install Termux from one trusted distribution source.
- [ ] Install `git`, `nodejs-lts`, `npm`, and `openssh`.
- [ ] Clone the authorised repository branch.
- [ ] Run `install-termux.sh`.
- [ ] Confirm all seven files pass exact size and Git blob SHA-1 checks.
- [ ] Confirm `node --check server.mjs` passes.

## Local service tests
- [ ] Start Node.js and confirm port 8787 listens only on 127.0.0.1.
- [ ] Open `http://127.0.0.1:8787` on the phone.
- [ ] Confirm all seven allow-listed links appear.
- [ ] Confirm invalid asset IDs return 404.
- [ ] Confirm a missing or incorrect token returns 403.
- [ ] Confirm expired/replayed/cross-client links are rejected.
- [ ] Confirm the 13th challenge request and 13th verification submission in their respective 10-minute windows are rate-limited.
- [ ] Confirm a challenge is invalidated after three incorrect proof submissions.
- [ ] Confirm byte-range download requests work within the short-lived session.
- [ ] Download all seven files and compare Git blob hashes with the manifest.

## Public tunnel tests
- [ ] Choose a tunnel provider and verify its SSH host key where supported.
- [ ] Confirm its HTTPS URL opens from a second device.
- [ ] Test each file through that public URL.
- [ ] Test a large file over a separate network.
- [ ] Confirm phone sleep, network switching, or process termination correctly stops the service.
- [ ] Configure Termux battery/background permissions for the intended uptime.

## GitHub cutover — not performed
- [ ] Confirm the phone has all seven verified copies.
- [ ] Confirm local and public downloads work for all seven.
- [ ] Confirm a second-device download is complete and hash-identical.
- [ ] Review public README/download links.
- [ ] Obtain explicit owner approval before deleting public copies or rewriting Git history.
- [ ] Plan cleanup of old commit references, releases, forks, and cached URLs.
- [ ] Publish a notice explaining the phone gateway's uptime and privacy limitations.

**Current status: prepared only.** No Cloudflare account is required by this module, and no original GitHub file has been modified or removed.

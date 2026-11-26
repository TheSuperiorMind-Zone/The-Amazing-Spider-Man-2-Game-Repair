# TSMZ Android Download Gateway

© Copyright by The Superior Mind-Zone.

An independent Node.js download gateway intended to run on an Android phone such as the OPPO A54 through Termux. The phone stores the protected copies, performs browser verification, rate-limits attempts, signs short-lived download links, and streams files. It uses Node.js built-ins only and does not use the game's source code.

## Status

**Prepared for phone-side installation — not yet installed, publicly reachable, or activated.** No public GitHub archive has been removed. The seven original GitHub files remain available directly until the phone copy and public cutover are verified.

## What is included

- Seven-file allow-list; no arbitrary path access.
- Installer copies files from the cloned repository into the gateway's private `protected-files` directory.
- Installer verifies each file's exact byte count and Git blob SHA-1 before and after copying.
- Lightweight browser proof-of-work challenge (14-bit SHA-256 target); this raises automated request cost but is not a human CAPTCHA.
- Maximum 12 challenge requests and 12 verification submissions per client key in each rolling 10-minute window; an individual challenge is invalidated after three incorrect proof submissions.
- HMAC-SHA-256 signed download links, two-minute expiry, client-key binding, one-time redemption.
- A short-lived HttpOnly download-session cookie allows normal HTTP byte-range/retry requests after redemption.
- Security headers, fixed asset paths, no raw IP logging, no external npm dependencies.
- Server binds to `127.0.0.1`; the phone is exposed only through an outbound SSH reverse tunnel.

This does not guarantee that every bot is blocked. Browser automation can solve proof-of-work, distributed IPs can reduce the effectiveness of per-IP throttling, and a determined downloader can still retrieve the files.

## OPPO A54 setup

Use the Termux app from its official F-Droid/GitHub distribution source. Do not mix Termux and add-ons from different installation sources.

1. Open Termux and install Git, Node.js and OpenSSH:
   ```sh
   pkg update -y
   pkg install -y git nodejs-lts npm openssh
   ```
2. Clone this repository's Android-gateway branch (replace the branch with `main` after it is merged):
   ```sh
   git clone --depth 1 --branch security/android-phone-gateway https://github.com/TheSuperiorMind-Zone/The-Amazing-Spider-Man-2-Game-Repair.git "$HOME/tsmz-phone-gateway"
   cd "$HOME/tsmz-phone-gateway/TSMZ_Android_Download_Gateway"
   bash install-termux.sh
   ```
3. Start the gateway in the first Termux session:
   ```sh
   npm start
   ```
   It must print `Verified assets: 7` and `Listening only on http://127.0.0.1:8787`.
4. Open a second Termux session and start the public tunnel:
   ```sh
   cd "$HOME/tsmz-phone-gateway/TSMZ_Android_Download_Gateway"
   bash start-tunnel.sh
   ```
5. Open the HTTPS URL printed by the selected tunnel provider. The file links use these paths:
   - `/download/crash-package`
   - `/download/hook-package`
   - `/download/note-3`
   - `/download/proof-video`
   - `/download/scanner-package`
   - `/download/systems-package`
   - `/download/render-tool`

Keep both Termux sessions running. If either process stops, the public gateway stops. Disable battery optimisation for Termux in Android settings and keep the phone charged while serving files. The exact menu labels depend on the ColorOS version.

## Tunnel options

The phone normally cannot accept unsolicited inbound connections over mobile data because carrier NAT/CGNAT blocks them. The SSH reverse tunnel avoids requiring an inbound port-forward on the phone or carrier network.

- `localhost.run`: free random HTTPS tunnel without an account; its free hostnames change regularly and are speed-limited. Keep the SSH connection open. Its current ED25519 host fingerprint is `SHA256:pG6qrBxubYfWa1Zadu/V0NUgjEDiBds/7e2xzte/QNM`; the script asks OpenSSH to validate the DNSSEC SSHFP record when supported.
- `tunnl.gg`: random HTTPS URL without an account; documented fair-use allowance is 5 GB/day, with a two-hour idle timeout and 24-hour maximum session. Browsers may show a provider warning page. A stable URL tied to the same SSH key can be requested with `stable@proxy.tunnl.gg`; you need an SSH key, but not a website account. Its current ED25519 host fingerprint is `SHA256:5uQ6VobmUpY4wyMmm5jnAwFtt3aX06WYDDM4ER+2WUw`; compare it with the first-connection SSH prompt.

The gateway trusts the selected tunnel provider to supply a genuine visitor `X-Forwarded-For` header. Do not expose the phone's local server through an unrelated proxy without revisiting that trust boundary.

Both tunnel providers terminate HTTPS at their edge before forwarding requests through the SSH tunnel to the phone. Treat them as third-party intermediaries that can process request metadata and unencrypted HTTP content at their edge. Do not put private credentials or unrelated files on this gateway.

## Local test before sharing

On the phone, open `http://127.0.0.1:8787` in a browser. Confirm all seven assets appear. Open each item, press **Verify and continue**, then confirm the expected file downloads. Test at least the 19.6 MB Proof Video archive. The gateway itself must not be called active until the public HTTPS tunnel has also been tested from a separate device or mobile-data connection.

## Important GitHub cutover rule

GitHub is still public. Direct raw links, Git clone, repository ZIP, blob links, and existing Git history can bypass this phone gateway. Do not delete or rewrite the seven public files until:

1. The installer reports all seven size and Git blob SHA-1 checks passed.
2. A local and public-tunnel download test succeeds for every file.
3. A second device downloads the files and confirms their hashes.
4. The owner explicitly proceeds with GitHub binary removal/history cleanup.

Even after removing files from the current branch, old commits, forks, cached URLs, or clones may retain them. History cleanup is a separate destructive operation and must be reviewed before execution.

## Privacy and reliability

- The gateway does not persist raw client IP addresses. It derives an HMAC key for rate limiting and link binding in memory.
- Challenge/rate/session state is in memory; restarting Node.js invalidates outstanding links and sessions.
- The signing secret is generated locally in `.token-secret`, excluded from Git, and never needs to be sent to ChatGPT.
- This is a phone-hosted service, not a 24/7 cloud host. Battery optimisation, heat, network changes, data caps, provider tunnel limits, and Termux process termination can interrupt downloads.

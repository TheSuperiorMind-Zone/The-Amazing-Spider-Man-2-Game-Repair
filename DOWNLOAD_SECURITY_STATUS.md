# Download Security Status

© Copyright by The Superior Mind-Zone.

**Status: PREPARED — NOT ACTIVE.**

A separate Cloudflare Turnstile + private R2 download gateway is prepared under `TSMZ_AntiBot_Download_Gateway/`. Its download gate is configured in source to allow at most **3 accepted download starts per IP in a rolling 20-second window**; verification attempts retain a separate 12-per-10-minute limit.

The repository remains public and the current downloadable files are still present. GitHub downloads, raw URLs, Git clones, archives, and old commit references can bypass a gateway until files are migrated to private R2 and retired from public GitHub storage/history.

No existing project archives, notes, game files, or source files were modified or deleted.

Activation requires a Cloudflare deployment, private R2 uploads and hash checks, full security tests, a planned GitHub binary/history cutover, and replacement of public download links. Do not describe downloads as protected until those steps are complete.

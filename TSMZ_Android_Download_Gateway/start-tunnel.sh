#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PORT="${PORT:-8787}"

if ! command -v ssh >/dev/null 2>&1; then
  echo "OpenSSH is missing. Run: pkg install openssh"
  exit 1
fi

cat <<'MENU'
TSMZ Android Gateway — public reverse tunnel

1) localhost.run  (no account; temporary URL; provider applies a speed limit)
2) tunnl.gg       (no account for random URL; 5 GB/day fair-use, 2-hour idle timeout, 24-hour cap; browser warning page may appear)
0) Cancel
MENU
read -r -p "Choose a tunnel provider: " choice
case "$choice" in
  1)
    echo "Connecting to localhost.run. Verify the SSH host fingerprint before accepting it."
    exec ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R "80:127.0.0.1:${PORT}" nokey@localhost.run
    ;;
  2)
    echo "Connecting to tunnl.gg. A random public HTTPS URL will be printed by the provider."
    exec ssh -t -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R "80:127.0.0.1:${PORT}" proxy.tunnl.gg
    ;;
  0)
    echo "Cancelled."
    ;;
  *)
    echo "Invalid selection."
    exit 2
    ;;
esac

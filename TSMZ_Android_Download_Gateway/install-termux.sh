#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DEST_DIR="$SCRIPT_DIR/protected-files"

pkg update -y
pkg install -y nodejs-lts npm openssh git

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: This gateway folder must remain inside the cloned Git repository."
  exit 1
fi

mkdir -p "$DEST_DIR"

copy_verified() {
  local filename="$1" expected_size="$2" expected_blob="$3"
  local source="$REPO_ROOT/$filename" destination="$DEST_DIR/$filename"
  if [ ! -f "$source" ]; then
    echo "ERROR: Missing source file in repository: $filename"
    exit 1
  fi
  local source_size source_blob copied_size copied_blob
  source_size="$(wc -c < "$source" | tr -d ' ')"
  source_blob="$(git -C "$REPO_ROOT" hash-object -- "$source")"
  if [ "$source_size" != "$expected_size" ] || [ "$source_blob" != "$expected_blob" ]; then
    echo "ERROR: Repository copy failed integrity check: $filename"
    exit 1
  fi
  cp -- "$source" "$destination"
  copied_size="$(wc -c < "$destination" | tr -d ' ')"
  copied_blob="$(git -C "$REPO_ROOT" hash-object -- "$destination")"
  if [ "$copied_size" != "$expected_size" ] || [ "$copied_blob" != "$expected_blob" ]; then
    echo "ERROR: Phone copy failed integrity check: $filename"
    exit 1
  fi
  chmod 600 "$destination" 2>/dev/null || true
  echo "PASS  $filename  $copied_size bytes  $copied_blob"
}

copy_verified "Crash.rar" "845621" "eff0fe00160f20db0c1d13ee618acfa18cd4b4bb"
copy_verified "Hook.zip" "382455" "d92cc5c9bf86b9af3f6e2deaee50002a03c70643"
copy_verified "Note 3.jpg" "871769" "79a3f634f9628fe88eb49580da18c5312b14e65b"
copy_verified "Proof Video.rar" "19598218" "6a0a40110ed566832fb26937029211eecf12934c"
copy_verified "Scanner.rar" "1230157" "a68c52fb451ee266e3e587859e60cb209fe9efea"
copy_verified "Systems.zip" "1534584" "2a43f6ac4426aabe9cde0f855970ffa6dacbdbf6"
copy_verified "The Amazing Spider-Man 2 - 4K Render Tool.rar" "4222601" "9b7796c750c3bad02c3342b3434e337b84404e8b"

node --check "$SCRIPT_DIR/server.mjs"
echo
echo "INSTALLATION COMPLETE: all seven files passed Git object SHA-1 and size checks."
echo "Start the local gateway with: cd '$SCRIPT_DIR' && npm start"
echo "In a second Termux session, run: bash '$SCRIPT_DIR/start-tunnel.sh'"

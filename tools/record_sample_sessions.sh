#!/usr/bin/env bash
# Records the sample playtest data shipped with the dashboard.
#
# Bot testers play the Reef Runner demo on build 0.3 (unfair spike gate, laggy
# jellyfish room, one crash) and build 0.4 (the fixes), headless and much
# faster than real time. The level maps are captured first, in a window.
# Everything is packed into addons/playtest_lens/dashboard/sample-data.js.
#
# Usage: GODOT=/path/to/godot_console_executable tools/record_sample_sessions.sh
set -euo pipefail
GODOT="${GODOT:-godot}"
cd "$(dirname "$0")/.."

tester() { # build seed name [extra args]
  echo "  build $1: $3"
  "$GODOT" --headless --path . --fixed-fps 60 -- --demo-bot --demo-build="$1" --demo-seed="$2" \
    --playtest-frame-clock --playtest-build="$1" --playtest-tester="$3" ${4:-} > /dev/null 2>&1 || true
}

echo "Capturing level maps (opens a window for a few seconds)"
"$GODOT" --path . -- --demo-capture-maps > /dev/null 2>&1 || true
"$GODOT" --headless --path . --script res://tools/sample_data.gd -- clear --playtest-off

echo "Recording build 0.3"
i=1
for name in Ava Ben Chen Dana Eli Farah Gus Hana Ivan Jade Kofi Lena Mateo Nora; do
  extra=""
  if [ "$name" = "Gus" ]; then extra="--demo-crash"; fi
  tester 0.3 "$i" "$name" "$extra" &
  if (( i % 4 == 0 )); then wait; fi
  i=$((i + 1))
done

wait
echo "Recording build 0.4"
for name in Ava Chen Eli Hana Jade Omar Priya Quinn Rosa Sami; do
  tester 0.4 "$i" "$name" &
  if (( i % 4 == 0 )); then wait; fi
  i=$((i + 1))
done

wait
"$GODOT" --headless --path . --script res://tools/sample_data.gd -- pack --playtest-off

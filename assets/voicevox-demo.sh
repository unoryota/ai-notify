#!/usr/bin/env bash
# Record-ready VOICEVOX demo: simulate several agents finishing in DIFFERENT
# character voices, each announcing (translated) what it did — the showcase for
# ai-notify's per-pane voices. Screen-record this with audio for the README.
#
# Prereqs:
#   - VOICEVOX app running (engine on http://127.0.0.1:50021)
#   - ai-notify on PATH, translation + VOICEVOX enabled:
#       ai-notify on
#       ai-notify translate on ja
#       ai-notify voicevox on
#   - List speaker ids with: ai-notify voicevox speakers   (edit SPEAKERS below)
set -euo pipefail

# label : VOICEVOX speaker id : the agent's (English) last message
ROWS=(
  "api|3|Fixed the auth token refresh and added three regression tests."
  "web|2|Refactored the checkout flow and removed two dead components."
  "infra|8|Migrated the database and verified the rollback path."
  "docs|14|Rewrote the README and added a quick-start section."
)

for row in "${ROWS[@]}"; do
  IFS='|' read -r label speaker msg <<<"$row"
  echo "▶ [$label] speaker=$speaker"
  AI_NOTIFY_LABEL="$label" AI_NOTIFY_VOICEVOX_SPEAKER="$speaker" \
    bash -c "echo '{\"cwd\":\"/demo/$label\",\"message\":\"$msg\"}' | ai-notify hook --source claude --event done"
  sleep 4
done

echo "done — each line spoke in its own character voice."

#!/bin/bash
# Menu bar indicator + toggle for ai-notify, via SwiftBar (or xbar).
#
# This is the recommended setup: an always-visible 🔔 / 🔕 in the macOS menu
# bar that you click to mute everything — no terminal needed, state always shown.
#
# Install:
#   1. brew install --cask swiftbar      (or xbar)
#   2. Copy this file into your SwiftBar plugin folder, keep the ".3s.sh"
#      suffix (refreshes every 3s), and make it executable:
#        chmod +x ai-notify.3s.sh
#   3. The icon appears in your menu bar. Click it → "Toggle mute".

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ICON=$(ai-notify status --icon 2>/dev/null || echo "❓")

# Menu bar title (just the glyph)
echo "$ICON"
echo "---"
# Dropdown actions. terminal=false runs silently; refresh=true re-renders the icon.
echo "Toggle mute | bash=ai-notify param1=toggle terminal=false refresh=true"
echo "Show status | bash=ai-notify param1=status terminal=true"

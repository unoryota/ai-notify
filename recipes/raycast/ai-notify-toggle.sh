#!/bin/bash
# Raycast Script Command: toggle ai-notify mute for all agents.
# Drop this file into your Raycast script directory and assign a hotkey.
#
# @raycast.schemaVersion 1
# @raycast.title Toggle AI Notify
# @raycast.mode compact
# @raycast.icon 🔔
# @raycast.packageName ai-notify
#
# Optional metadata:
# @raycast.description Mute/unmute notifications for all terminal AI agents at once

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
ai-notify toggle

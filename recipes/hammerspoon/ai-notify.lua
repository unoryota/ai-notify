-- Menu bar indicator + global hotkey for ai-notify, via Hammerspoon.
--
-- Gives you BOTH at once, with no extra app beyond Hammerspoon (free):
--   * an always-visible 🔔 / 🔕 in the menu bar (click to toggle)
--   * a global hotkey (⌃⌥M) that toggles from anywhere — even while a terminal
--     is busy running an agent, because the hotkey runs in its own process and
--     never types into that terminal.
--
-- The toggle is INSTANT and RELIABLE: it writes the shared mute flag file
-- directly (the same file ai-notify reads), so the icon always reflects the
-- real state — it never gets ahead of a slow/failed subprocess.
--
-- Install:
--   1. brew install --cask hammerspoon  (and launch it once)
--   2. Append the contents of this file to ~/.hammerspoon/init.lua
--   3. Reload Hammerspoon config.

local function flagPath()
  local base = os.getenv("XDG_STATE_HOME")
  return (base and (base .. "/ai-notify/muted"))
    or (os.getenv("HOME") .. "/.local/state/ai-notify/muted")
end

local function isMuted()
  local f = io.open(flagPath(), "r")
  if f then f:close() return true end
  return false
end

-- Authoritative: write/remove the flag file directly. Instant, can't fail to a
-- subprocess, and is the single source of truth ai-notify and its hooks read.
local function setMuted(muted)
  local p = flagPath()
  if muted then
    local f = io.open(p, "w")
    if not f then
      hs.fs.mkdir(p:match("(.*)/")) -- create the state dir if missing
      f = io.open(p, "w")
    end
    if f then f:close() end
  else
    os.remove(p)
  end
end

local menubar = hs.menubar.new()

local function setIcon(muted)
  if menubar then menubar:setTitle(muted and "🔕" or "🔔") end
end

local function render() setIcon(isMuted()) end

local function toggle()
  local newMuted = not isMuted()
  setMuted(newMuted) -- flip the real state first
  setIcon(newMuted)  -- icon always matches reality
  if not newMuted then
    -- brief confirmation chime on un-mute (async, best-effort)
    hs.task.new("/usr/bin/afplay", nil, { "-v", "2", "/System/Library/Sounds/Glass.aiff" }):start()
  end
end

if menubar then menubar:setClickCallback(toggle) end
hs.hotkey.bind({ "ctrl", "alt" }, "M", toggle)

-- Safety reconciler in case the flag is changed elsewhere (CLI, another tool).
hs.timer.doEvery(2, render)
render()

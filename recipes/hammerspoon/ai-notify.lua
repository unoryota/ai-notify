-- Menu bar indicator + global hotkey for ai-notify, via Hammerspoon.
--
-- Gives you BOTH at once, with no extra app beyond Hammerspoon (free):
--   * an always-visible 🔔 / 🔕 in the menu bar (click to toggle)
--   * a global hotkey (⌃⌥M) that toggles from anywhere — even while a terminal
--     is busy running an agent, because the hotkey runs in its own process and
--     never types into that terminal.
--
-- Install:
--   1. brew install --cask hammerspoon  (and launch it once)
--   2. Append the contents of this file to ~/.hammerspoon/init.lua
--   3. Reload Hammerspoon config.

local function isMuted()
  -- Respect XDG_STATE_HOME if set, else default.
  local base = os.getenv("XDG_STATE_HOME")
  local flag = (base and (base .. "/ai-notify/muted"))
    or (os.getenv("HOME") .. "/.local/state/ai-notify/muted")
  local f = io.open(flag, "r")
  if f then f:close() return true end
  return false
end

local menubar = hs.menubar.new()

local function render()
  if menubar then menubar:setTitle(isMuted() and "🔕" or "🔔") end
end

local function toggle()
  -- true = run in a login shell so `ai-notify` is on PATH
  hs.execute("ai-notify toggle", true)
  render()
end

if menubar then menubar:setClickCallback(toggle) end
hs.hotkey.bind({ "ctrl", "alt" }, "M", toggle)

-- Keep the icon honest even if the flag is changed elsewhere.
hs.timer.doEvery(2, render)
render()

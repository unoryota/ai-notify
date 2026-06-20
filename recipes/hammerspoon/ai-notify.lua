-- Menu bar indicator + global hotkey for ai-notify, via Hammerspoon.
--
-- Gives you BOTH at once, with no extra app beyond Hammerspoon (free):
--   * an always-visible 🔔 / 🔕 in the menu bar (click to toggle)
--   * a global hotkey (⌃⌥M) that toggles from anywhere — even while a terminal
--     is busy running an agent, because the hotkey runs in its own process and
--     never types into that terminal.
--
-- The toggle is INSTANT: the icon flips immediately (optimistically) and the
-- real work runs asynchronously, so a click never waits on a subprocess.
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

local menubar = hs.menubar.new()

local function setIcon(muted)
  if menubar then menubar:setTitle(muted and "🔕" or "🔔") end
end

local function render() setIcon(isMuted()) end

-- Resolve absolute paths ONCE at load (interactive login shell, so nvm/Homebrew
-- PATHs are honored). Caching them lets each toggle run node directly with no
-- shell startup — fast, and independent of the task's PATH.
local NODE = (hs.execute("command -v node", true) or ""):gsub("%s+$", "")
local AI_NOTIFY = (hs.execute("command -v ai-notify", true) or ""):gsub("%s+$", "")

local function toggle()
  -- 1) Flip the icon immediately — never block the UI on a subprocess.
  setIcon(not isMuted())
  -- 2) Do the real toggle (state + confirmation sound/voice) asynchronously,
  --    then reconcile the icon with the actual result.
  local done = function() render() end
  if NODE ~= "" and AI_NOTIFY ~= "" then
    hs.task.new(NODE, done, { AI_NOTIFY, "toggle" }):start()
  else
    -- Fallback if resolution failed: interactive login shell on PATH.
    hs.task.new(os.getenv("SHELL") or "/bin/zsh", done, { "-lic", "ai-notify toggle" }):start()
  end
end

if menubar then menubar:setClickCallback(toggle) end
hs.hotkey.bind({ "ctrl", "alt" }, "M", toggle)

-- Safety reconciler in case the flag is changed elsewhere (CLI, another tool).
hs.timer.doEvery(2, render)
render()

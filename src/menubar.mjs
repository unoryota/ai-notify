// Native menu bar agent management (macOS).
//
// Ships a tiny self-contained NSStatusItem app (menubar/) and runs it as a
// per-user LaunchAgent so a live 🔔/🔕 appears in the menu bar — with NO
// third-party app (Hammerspoon/SwiftBar/etc.) required.
//
// The app and the CLI share one truth: the mute flag file. No IPC, no daemon
// beyond this one lightweight GUI agent.

import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

export const LABEL = 'com.ai-notify.menubar';

const pkgRoot = () => dirname(dirname(fileURLToPath(import.meta.url))); // .../ai-notify
const menubarDir = () => join(pkgRoot(), 'menubar');
export const appPath = () => join(menubarDir(), 'dist', 'ai-notify.app');
const exePath = () => join(appPath(), 'Contents', 'MacOS', 'ai-notify-menubar');
const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

export const isMac = () => platform() === 'darwin';
export const isBuilt = () => existsSync(exePath());
export const isInstalled = () => existsSync(plistPath());

export const isRunning = () => {
  const r = spawnSync('pgrep', ['-f', 'ai-notify-menubar'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim().length > 0;
};

// Build the .app from source with the system Swift toolchain (no Xcode project).
export const build = () => {
  const script = join(menubarDir(), 'build.sh');
  if (!existsSync(script)) throw new Error('menubar/build.sh missing');
  execFileSync('bash', [script], { stdio: 'inherit' });
  return appPath();
};

const writePlist = () => {
  const dir = dirname(plistPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exePath()}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
`;
  writeFileSync(plistPath(), xml);
};

const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });

const killExisting = () => spawnSync('pkill', ['-f', 'ai-notify-menubar']);

// Load (and start) the agent. Tries the modern domain API, falls back to legacy.
const load = () => {
  const uid = process.getuid();
  killExisting(); // avoid a duplicate icon if one was launched by hand
  let r = launchctl('bootstrap', `gui/${uid}`, plistPath());
  if (r.status !== 0) r = launchctl('load', '-w', plistPath());
  launchctl('kickstart', '-k', `gui/${uid}/${LABEL}`);
  return r;
};

const unload = () => {
  const uid = process.getuid();
  let r = launchctl('bootout', `gui/${uid}/${LABEL}`);
  if (r.status !== 0) r = launchctl('unload', '-w', plistPath());
  killExisting();
  return r;
};

export const install = () => {
  if (!isMac()) throw new Error('the menu bar agent is macOS-only');
  if (!isBuilt()) build();
  writePlist();
  load();
  return { app: appPath(), plist: plistPath() };
};

export const uninstall = () => {
  if (isInstalled()) unload();
  else killExisting();
  if (existsSync(plistPath())) rmSync(plistPath());
  return { plist: plistPath() };
};

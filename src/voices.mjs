// Voice discovery & preview for the spoken read-out.
//
// macOS only: we shell out to the built-in `say` command, which ships a large
// set of offline system voices. No network, no API, no cost — switching voices
// is free. On other platforms this returns an empty list and the `voice`
// command degrades to "set any name you like by hand".

import { execFileSync } from 'node:child_process';

const isMac = process.platform === 'darwin';

// Curated, ordered shortlist of distinct, good-quality built-in voices. We only
// show the ones actually installed, then pad up to `limit` from the rest so the
// menu is always ~10 even on a trimmed-down system.
const PRESET = [
  'Kyoko', 'Eddy', 'Flo', 'Reed', 'Rocko', 'Sandy', 'Shelley',
  'Grandpa', 'Grandma', 'Otoya', 'Samantha', 'Alex', 'Daniel', 'Karen',
];

// Unique base voice names installed on this machine. Multilingual voices are
// listed once per language by `say -v ?` (e.g. "Eddy (日本語（日本）)"); we strip
// the "(language)" suffix and de-duplicate, since `say -v Eddy` works directly.
export const installedVoiceNames = () => {
  if (!isMac) return [];
  let out = '';
  try {
    out = execFileSync('say', ['-v', '?'], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const names = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(.+?)\s{2,}/); // name column = text before 2+ spaces
    if (!m) continue;
    const name = m[1].replace(/\s*\(.*\)\s*$/, '').trim(); // drop "(language)" suffix
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
};

// The ~10 options shown by `ai-notify voice`.
export const curatedVoices = (limit = 10) => {
  const installed = installedVoiceNames();
  const have = new Set(installed);
  const picked = PRESET.filter((n) => have.has(n));
  for (const n of installed) {
    if (picked.length >= limit) break;
    if (!picked.includes(n)) picked.push(n);
  }
  return picked.slice(0, limit);
};

// Resolve a user argument (1-based number, or a name) to an installed voice.
export const resolveVoice = (arg, list) => {
  if (!arg) return null;
  if (/^\d+$/.test(arg)) return list[Number(arg) - 1] || null;
  const all = installedVoiceNames();
  return all.find((n) => n.toLowerCase() === String(arg).toLowerCase()) || null;
};

// Speak a sample synchronously so previews play one after another, in order.
export const previewVoice = (name, text) => {
  if (!isMac || !name || !text) return;
  try {
    execFileSync('say', ['-v', name, text], { stdio: 'ignore' });
  } catch {
    /* voice missing / say unavailable — ignore */
  }
};

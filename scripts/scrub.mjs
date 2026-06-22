#!/usr/bin/env node
// Privacy scrub: fail if any tracked file leaks personal / private data.
// Runs in CI and is worth running before any publish.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Patterns that must never appear in the published source. Kept as RegExp so
// this file can describe them without being flagged by its own scan (it is
// excluded below).
const FORBIDDEN = [
  { name: 'absolute /Users path', re: /\/Users\/[a-z0-9._-]+/i },
  { name: 'absolute /home path', re: /\/home\/[a-z0-9._-]+/i },
  { name: 'company name "subscline"', re: /subscline/i },
  { name: 'readonly db env', re: /AI_READONLY/ },
  { name: 'personal gmail', re: /onionringfry/i },
];

const SKIP_FILES = new Set([join(ROOT, 'scripts', 'scrub.mjs')]);

const isTexty = (f) => /\.(mjs|js|ts|json|md|yml|yaml|sh|toml|txt)$/.test(f) || !/\.[a-z0-9]+$/i.test(f);

// Only scan files that are actually committed — untracked / .gitignored working
// files (local promo builds, scratch dirs) are never published, so they must not
// fail the scrub. This is what "tracked file leaks" in the header means.
const trackedFiles = () =>
  execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 1 << 24 })
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((f) => join(ROOT, f))
    .filter((f) => isTexty(f) && !SKIP_FILES.has(f));

let failures = 0;
for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, re } of FORBIDDEN) {
    const m = text.match(re);
    if (m) {
      console.error(`✗ ${file.replace(ROOT, '')}: ${name} -> "${m[0]}"`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\nScrub failed: ${failures} match(es). Remove private data before publishing.`);
  process.exit(1);
}
console.log('✓ scrub clean — no personal/private data found.');

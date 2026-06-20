#!/usr/bin/env node
// Privacy scrub: fail if any tracked file leaks personal / private data.
// Runs in CI and is worth running before any publish.

import { readdirSync, readFileSync, statSync } from 'node:fs';
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

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILES = new Set([join(ROOT, 'scripts', 'scrub.mjs')]);

const isTexty = (f) => /\.(mjs|js|ts|json|md|yml|yaml|sh|toml|txt)$/.test(f) || !/\.[a-z0-9]+$/i.test(f);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (isTexty(full) && !SKIP_FILES.has(full)) out.push(full);
  }
  return out;
};

let failures = 0;
for (const file of walk(ROOT)) {
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

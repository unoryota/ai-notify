// Optional translation of an agent's spoken message into the user's language.
//
// The popular key-less translation npm packages (google-translate-api-x,
// @vitalets/google-translate-api, bing-translate-api, ...) all boil down to one
// HTTP GET against a public, key-less translate endpoint plus a little array
// parsing. Rather than take a dependency, we reimplement that in a few lines
// with `curl` — keeping the package dependency-free, with no API key and no
// cost. (It does make a network request; offline use falls back to templates.)
//
// Best-effort: any failure returns null and the caller falls back to a
// localized template, so notifications never break or hang.

import { execFileSync } from 'node:child_process';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

// Translate `text` into `to` (BCP-47-ish, e.g. 'ja'). Source auto-detected.
export const translate = (text, to = 'ja', timeoutMs = 4000) => {
  if (!text || !to) return null;
  try {
    const out = execFileSync(
      'curl',
      [
        '-s',
        '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        '-G', ENDPOINT,
        '--data-urlencode', `q=${text}`,
        '-d', 'client=gtx',
        '-d', 'sl=auto',
        '-d', `tl=${to}`,
        '-d', 'dt=t',
      ],
      { timeout: timeoutMs + 1000, encoding: 'utf8', maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const data = JSON.parse(out);
    // Shape: [ [ [translatedChunk, originalChunk, ...], ... ], ..., srcLang ]
    const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
    const result = segments
      .map((s) => (s && typeof s[0] === 'string' ? s[0] : ''))
      .join('')
      .trim();
    return result || null;
  } catch {
    return null;
  }
};

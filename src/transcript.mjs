// Summarize a Claude Code transcript (JSONL) into a short read-out line — the
// agent's last reply for THIS turn. Kept in its own module so it can be unit
// tested without importing the CLI (which dispatches on import).

import { readFileSync } from 'node:fs';

// Upper bound on the agent text we keep. The spoken read-out length is governed
// downstream by the 要約度 slider (notify.mjs); this is only a sanity ceiling so a
// pathologically long final turn can't blow up the banner / translation. Kept
// generous enough that "full read" (要約度 100%) and the ~20s tier are honored.
const SUMMARY_MAX = 2000;

// A genuine turn boundary: a user-role message whose content is real input
// (a human/system prompt — string or text blocks), NOT a tool_result envelope.
// Claude Code logs tool results as user-role messages too, so we must tell them
// apart to find where the current turn actually begins.
const isHumanTurn = (obj) => {
  if (obj?.type !== 'user') return false;
  const c = obj.message?.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return c.some((b) => b?.type === 'text') && !c.some((b) => b?.type === 'tool_result');
  return false;
};

// Pull the agent's last assistant text, BOUNDED to the current turn: the scan
// stops at the most recent genuine user message. A turn often ends with the
// assistant's last entry being tool_use only (no text), or the final text line
// not yet flushed when the Stop hook fires — without this bound the backward
// scan would cross into the PREVIOUS turn and surface ITS summary (a stale,
// wrong read-out). If the current turn has no assistant text yet, return '' so
// the caller falls back to the generic template instead of a previous summary.
export const summarizeTranscript = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'user') {
      if (isHumanTurn(obj)) break; // reached this turn's start; no newer assistant text → fall back
      continue; // tool_result user entry — keep scanning within the turn
    }
    if (obj.type !== 'assistant') continue;
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;
    const summary = content
      .filter((c) => c?.type === 'text' && c.text)
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (summary) return summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX)}…` : summary;
  }
  return '';
};

// File wrapper used by the hook. Returns '' on an unreadable transcript so the
// notification falls back to its template.
export const lastAssistantText = (transcriptPath) => {
  try {
    return summarizeTranscript(readFileSync(transcriptPath, 'utf8'));
  } catch {
    return '';
  }
};

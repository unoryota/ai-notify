// Provider registry. To add a new agent, implement a provider module with the
// shape { id, displayName, detect, status, wire, unwire } and add it here.

import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import * as gemini from './gemini.mjs';

export const providers = [claude, codex, gemini];

export const byId = (id) => providers.find((p) => p.id === id);

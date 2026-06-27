// route.mjs — turn a spoken utterance into "which pane + what to inject".
//
// PURE: no fs, no tmux, no globals. The CLI (`ai-notify reply`) reads the state
// files, hands this a normalized list of panes, and acts on the decision. That
// keeps the hard part — natural-language → {target, command} — fully unit
// testable (test/route.test.mjs) and lets Phase 4 swap in an LLM behind the
// same return shape.
//
// A pane passed in looks like:
//   { tty, name, waiting: bool, msg: string, options?: [{key,label}] }
// A decision looks like:
//   { ok, tty, name, action, text, keys, label, confidence, reason }
// where the injection is: type `text` (may be ''), then press each of `keys`.

// Fold full-width katakana → hiragana (ジョン → じょん) so speech recognition that
// returns either kana form still matches a name typed in the other. (NFKC alone
// does NOT unify the two kana.) Leaves the prolonged-sound mark ー untouched.
const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// Normalize for matching: NFKC folds full-width → ASCII (Ａ→A) and half-width
// kana (ｼﾞｮﾝ→ジョン), drop whitespace / punctuation, then STRIP voicing marks
// (dakuten/handakuten) so ポ=ボ=ホ, カ=ガ, シ=ジ all match. Speech recognition
// very often mis-voices a name ("ポール"→"ボール", the #1 routing miss), and names
// rarely differ only by a dakuten — so folding voicing is a big robustness win.
// (NFD splits a voiced kana into base + combining mark; we delete the mark.)
// Finally fold katakana→hiragana and lowercase Latin. The COMMAND text keeps its
// voicing — only matching is fuzzed (sanitize() works off the original).
const VOICING = /[\u3099\u309A\u309B\u309C\uFF9E\uFF9F]/g;
const norm = (s) =>
  kataToHira(
    String(s || '')
      .normalize('NFKC')
      .replace(/[\s、。，．.,!！?？「」『』（）()・:：;；]/g, '')
      .normalize('NFD')
      .replace(VOICING, '')
  )
    .normalize('NFC')
    .toLowerCase();

// Wake words spoken before the pane name ("へい じょん …"). Stripped from the
// FRONT before we look for the address, so the name is matched as a prefix.
// Includes "はい" because speech recognition often hears "へい" as "はい"; at the
// FRONT it's always a wake word (an affirmation only ever follows a name).
const WAKE = ['へい', 'はい', 'ねえ', 'ねぇ', 'おーい', 'おい', 'おっす', 'hey', 'ok'];

// Return the ORIGINAL substring that follows `normName` (a normalized name), with
// the original spacing/case preserved — norm() is lossy (drops spaces), so we
// can't slice the normalized string for free-form dictation. We re-normalize the
// original char by char, mapping each normalized position back to an original
// index, then cut after the name. Returns null if the name isn't present.
const afterName = (original, normName) => {
  if (!normName) return original;
  // Compose first (NFC): speech recognition emits voiced kana decomposed
  // (シ + ゛ instead of ジ). norm() folds the WHOLE string at once so it still
  // finds the name, but this per-character loop can't compose a base+combining
  // pair that spans two iterations — leaving an orphaned ゛ that hides the name
  // and makes afterName return null (→ empty command). Pre-composing aligns the
  // two so the name is found whether dictated or typed.
  const composed = original.normalize('NFC');
  const chars = [...composed];
  let normStr = '';
  const endIdx = []; // endIdx[k] = original index just past the char that produced normStr[k]
  for (let i = 0; i < chars.length; i++) {
    const nc = norm(chars[i]);
    for (let j = 0; j < nc.length; j++) {
      normStr += nc[j];
      endIdx.push(i + 1);
    }
  }
  const pos = normStr.indexOf(normName);
  if (pos < 0) return null;
  return composed.slice(endIdx[pos + normName.length - 1]);
};

// Strip control chars and collapse whitespace for anything we type into a shell.
// Keeps single spaces (so "echo hello world" survives), unlike norm().
const sanitize = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

// Spoken option tokens → 1-based index. Latin letters and digits are handled
// directly; these cover the common Japanese readings.
const KANA_ALPHA = { えー: 1, びー: 2, しー: 3, でぃー: 4, いー: 5 };
const KANA_NUM = { いち: 1, に: 2, さん: 3, よん: 4, し: 4, ご: 5, ろく: 6, なな: 7, しち: 7, はち: 8 };

// "yes / go ahead" and "no / cancel" — whole-utterance shortcuts. Approve presses
// Enter (selects the default-highlighted choice in a TUI menu, harmless on a free
// prompt); deny presses Escape (cancels the prompt).
const AFFIRM = ['はい', 'ええ', 'うん', 'おっけー', 'おーけー', 'オーケー', '了解', 'りょうかい', '許可', '承認', 'いいよ', 'おねがい', 'お願い', 'やって', 'すすめて', '進めて', 'ゴー', 'yes', 'ok', 'go'];
const DENY = ['いいえ', 'いや', 'だめ', 'やめて', '却下', '拒否', 'キャンセル', 'とりやめ', 'ノー', 'no', 'stop', 'とめて', '止めて'];

// Detect an option token at the START of the command remainder (after the pane
// name). Returns { index } or null. Kana numbers must be followed by 「ばん」 so
// the particle 「に」(=to) isn't misread as 2.
const leadingOption = (rest) => {
  let m;
  if ((m = /^([a-z])(?![a-z])/.exec(rest))) return { index: m[1].charCodeAt(0) - 96 };
  if ((m = /^([1-9])/.exec(rest))) return { index: Number(m[1]) };
  if ((m = /^(えー|びー|しー|でぃー|いー)/.exec(rest))) return { index: KANA_ALPHA[m[1]] };
  if ((m = /^(いち|に|さん|よん|し|ご|ろく|なな|しち|はち)ばん/.exec(rest))) return { index: KANA_NUM[m[1]] };
  return null;
};

const matchesAny = (rest, words) => words.some((w) => rest.startsWith(norm(w)));

// Light parser for explicit "A: … / B: …" or "1. … / 2) …" menus that some
// agents put right in the notification text. Returns [{key,label}] or null.
// (Most Claude prompts carry the choices in the TUI, not the hook payload, so
// this is often null — option selection then falls back to numbered keys.)
export const parseOptions = (msg) => {
  const s = String(msg || '');
  // key marker (A: / 1. / B）) then a lazy label that stops before the next
  // option marker, a sentence break, or end of string.
  const re = /(?:^|[\s、。])([A-Za-z]|[1-9])\s*[:：.)）]\s*(.+?)(?=(?:[\s、。]+(?:[A-Za-z]|[1-9])\s*[:：.)）])|[\n、。]|$)/g;
  const out = [];
  let m;
  while ((m = re.exec(s))) out.push({ key: m[1].toUpperCase(), label: m[2].trim() });
  return out.length >= 2 ? out : null;
};

const fail = (action, reason) => ({ ok: false, action, reason, confidence: 0 });

const ok = (pane, d) => ({
  ok: true,
  tty: pane.tty,
  name: pane.name || '',
  text: '',
  keys: [],
  ...d,
});

// Main entry. `panes` is the normalized pane list; `opts.minConfidence` lets the
// caller treat low-confidence reads as "ask again" instead of acting.
export function resolveCommand(spokenText, panes = []) {
  const text = String(spokenText || '').trim();
  if (!text) return fail('empty', '何も聞き取れませんでした');
  const n = norm(text);

  // 1. Pick the target pane. People address a pane the way they'd address a
  //    person: "(へい) <name>, <command>" — the name comes FIRST. So strip a
  //    leading wake word and match a pane name as a PREFIX of what's left
  //    (longest first, so "ずんだもんアルファ" beats "ずんだもん"). This stops a
  //    command that happens to contain another pane's name (e.g. "…本番環境ヘルス
  //    チェック") from hijacking the routing. Only if nothing matches at the front
  //    do we fall back to a name appearing anywhere, then a sole waiting/only pane.
  const named = panes.filter((p) => p.name && norm(p.name));
  const byLen = [...named].sort((a, b) => norm(b.name).length - norm(a.name).length);
  let addr = n;
  for (const w of WAKE) {
    const nw = norm(w);
    if (nw && addr.startsWith(nw)) {
      addr = addr.slice(nw.length);
      break;
    }
  }
  let target = null;
  let nameHit = '';
  for (const p of byLen) {
    const nn = norm(p.name);
    if (nn && addr.startsWith(nn)) {
      target = p;
      nameHit = nn;
      break;
    }
  }
  if (!target) {
    // Fallback: a name mentioned anywhere in the utterance.
    for (const p of byLen) {
      const nn = norm(p.name);
      if (nn && n.includes(nn)) {
        target = p;
        nameHit = nn;
        break;
      }
    }
  }
  let confidence = 0.9;
  if (!target) {
    const waiting = panes.filter((p) => p.waiting);
    if (waiting.length === 1) {
      target = waiting[0];
      confidence = 0.6;
    } else if (panes.length === 1) {
      target = panes[0];
      confidence = 0.55;
    } else {
      const names = waiting.map((p) => p.name || p.tty).filter(Boolean);
      if (waiting.length > 1)
        return fail('ambiguous', `どの端末か特定できません（待機中: ${names.join('、')}）`);
      return fail('no-target', '対象の端末が見つかりません。名前を付けて指示してください');
    }
  }

  // 2. Remainder = whatever follows the matched name. Keep BOTH forms: a
  //    normalized one for option/shortcut detection, and the original (spaces +
  //    case preserved) for free-form dictation that gets typed verbatim.
  let origRest = (nameHit ? afterName(text, nameHit) : text) ?? '';
  origRest = origRest.replace(/^(さん|くん|ちゃん)/, ''); // drop an honorific right after the name
  origRest = origRest.replace(/^[\s、。,.:：・]+/, '');
  const rest = norm(origRest);

  // 3a. Leading option token → select that choice. If the pane carries an
  //     explicit option with its own keys/text (e.g. a permission template:
  //     A 許可→Enter, B 拒否→Escape), inject exactly that; otherwise fall back
  //     to pressing the number key (a TUI menu acts on the digit itself).
  const optTok = leadingOption(rest);
  if (optTok && optTok.index >= 1) {
    const known = target.options && target.options[optTok.index - 1];
    const hasExplicit = known && (known.keys?.length || known.text);
    return ok(target, {
      action: 'option',
      text: hasExplicit ? known.text || '' : String(optTok.index),
      keys: hasExplicit ? known.keys || [] : [],
      label: known ? `選択肢 ${known.key}: ${known.label}` : `選択肢 ${optTok.index}`,
      confidence,
      reason: `${target.name || target.tty} の選択肢 ${known ? known.key : optTok.index} を選びます`,
    });
  }

  // 3b. Whole-utterance affirmation / negation.
  if (matchesAny(rest, AFFIRM))
    return ok(target, { action: 'shortcut', keys: ['Enter'], label: '承認 (はい)', confidence, reason: `${target.name || target.tty} を承認します` });
  if (matchesAny(rest, DENY))
    return ok(target, { action: 'shortcut', keys: ['Escape'], label: '却下 (いいえ)', confidence, reason: `${target.name || target.tty} を却下します` });

  // 3c. Free-form dictation → type it as a prompt and submit (original spacing).
  const body = sanitize(origRest);
  if (!body) return fail('empty-command', `「${target.name || target.tty}」への命令が聞き取れませんでした`);
  return ok(target, {
    action: 'freeform',
    text: body,
    keys: ['Enter'],
    label: `「${body}」を入力`,
    // Without a named target (sole-pane guess) keep free-form low so the caller
    // can confirm before blindly typing into the wrong agent.
    confidence: nameHit ? Math.min(confidence, 0.8) : Math.min(confidence, 0.5),
    reason: `${target.name || target.tty} に「${body}」を入力して実行します`,
  });
}

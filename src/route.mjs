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
const VOICING = /[゙゚゛゜ﾞﾟ]/g;
const PUNCT = /[\s、。，．.,!！?？「」『』（）()・:：;；]/;

// Per-character fold for NON-Latin text: drop punctuation, strip voicing marks,
// katakana→hiragana, lowercase. Latin is folded separately by the romaji table.
const normChar = (ch) => {
  const c = ch.normalize('NFKC');
  if (PUNCT.test(c)) return '';
  return kataToHira(c.normalize('NFD').replace(VOICING, '')).normalize('NFC').toLowerCase();
};

// Romaji → hiragana, so whisper's English spelling of a Japanese name folds to the
// SAME kana as the pane name: "John"/"Jon" → じょん == "ジョン". Speech recognition
// romanizes a name when an English command follows it ("Hey John Git status…"),
// which otherwise misses the wake gate entirely. Greedy longest-match; L→R; a lone
// leftover consonant (the silent "h" in "John") is skipped.
// prettier-ignore
const ROMAJI = {
  a:'あ',i:'い',u:'う',e:'え',o:'お',
  ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ', ga:'が',gi:'ぎ',gu:'ぐ',ge:'げ',go:'ご',
  sa:'さ',si:'し',shi:'し',su:'す',se:'せ',so:'そ', za:'ざ',zi:'じ',ji:'じ',zu:'ず',ze:'ぜ',zo:'ぞ',
  ta:'た',ti:'ち',chi:'ち',tu:'つ',tsu:'つ',te:'て',to:'と', da:'だ',de:'で',do:'ど',
  na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の', ha:'は',hi:'ひ',fu:'ふ',hu:'ふ',he:'へ',ho:'ほ',
  ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ', pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',
  ma:'ま',mi:'み',mu:'む',me:'め',mo:'も', ya:'や',yu:'ゆ',yo:'よ',
  ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ', la:'ら',li:'り',lu:'る',le:'れ',lo:'ろ',
  wa:'わ',wo:'を',vu:'ぶ',n:'ん',
  kya:'きゃ',kyu:'きゅ',kyo:'きょ', sha:'しゃ',shu:'しゅ',sho:'しょ', sya:'しゃ',syu:'しゅ',syo:'しょ',
  cha:'ちゃ',chu:'ちゅ',cho:'ちょ', ja:'じゃ',ju:'じゅ',jo:'じょ',jya:'じゃ',jyu:'じゅ',jyo:'じょ',
  nya:'にゃ',nyu:'にゅ',nyo:'にょ', hya:'ひゃ',hyu:'ひゅ',hyo:'ひょ', mya:'みゃ',myu:'みゅ',myo:'みょ',
  rya:'りゃ',ryu:'りゅ',ryo:'りょ', gya:'ぎゃ',gyu:'ぎゅ',gyo:'ぎょ',
  bya:'びゃ',byu:'びゅ',byo:'びょ', pya:'ぴゃ',pyu:'ぴゅ',pyo:'ぴょ',
};
// Unvoice every romaji output to match the voicing-STRIPPED kana side (normChar
// folds じ→し, ぎ→き …), so "jo"→じょ→しょ aligns with "ジョン"→しょん. Without this
// the romaji key would stay voiced and never match. Char count is preserved, so
// foldWithEnds' index map stays aligned.
for (const k of Object.keys(ROMAJI)) ROMAJI[k] = normChar(ROMAJI[k]);

// Fold a string to a hiragana match-key AND, for each output char, the index in
// the (NFKC) source just past the char(s) that produced it — so the command after
// a matched name can be sliced from the ORIGINAL text (the fold is lossy).
const foldWithEnds = (original, romaji = true) => {
  const src = [...String(original || '').normalize('NFKC')];
  let folded = '';
  const ends = [];
  const emit = (str, end) => {
    for (const c of str) {
      folded += c;
      ends.push(end);
    }
  };
  let i = 0;
  while (i < src.length) {
    if (romaji && /[a-zA-Z]/.test(src[i])) {
      let j = i;
      let run = '';
      while (j < src.length && /[a-zA-Z]/.test(src[j])) run += src[j++];
      run = run.toLowerCase();
      const startLen = folded.length;
      let k = 0;
      while (k < run.length) {
        let hit = '';
        let len = 0;
        for (let L = Math.min(3, run.length - k); L >= 1; L--) {
          if (ROMAJI[run.slice(k, k + L)]) {
            hit = ROMAJI[run.slice(k, k + L)];
            len = L;
            break;
          }
        }
        if (len) {
          emit(hit, i + k + len);
          k += len;
        } else {
          k += 1; // lone consonant (e.g. the "h" in "john") → skip
        }
      }
      // A TRAILING unmapped consonant (the "l" in "Paul") emits nothing, so the
      // last syllable's end stops before it and that letter leaks into the command
      // ("…run test" → "l, run test"). Pin the last folded char of this run to the
      // run's end so the whole latin token is consumed. (Mid-word skips like the
      // "h" in "john" already end at the next syllable, so this is a no-op there.)
      if (folded.length > startLen) ends[folded.length - 1] = j;
      i = j;
    } else {
      // Non-Latin, OR Latin when romaji folding is OFF (English speaker): keep the
      // character as-is (lowercased), 1:1. English names match directly then, and
      // the romaji fold ("John"→じょん) doesn't get in the way.
      emit(romaji ? normChar(src[i]) : src[i].normalize('NFKC').toLowerCase().replace(PUNCT, ''), i + 1);
      i += 1;
    }
  }
  return { folded, ends };
};

const norm = (s, romaji = true) => foldWithEnds(s, romaji).folded;

// Like norm() but WITHOUT romaji folding — Latin stays Latin. Used for matching
// the command keywords AFTER the name (option letters "A", affirmations "yes/go",
// kana readings). Romaji-folding those would collapse e.g. "go"→ご→こ and then any
// command starting with こ ("コミット") would falsely read as 承認.
const normLite = (s) =>
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
// "へい/えい/うぇい" are all how whisper renders a spoken "Hey" (it flips between
// ヘイ / エイ / ウェイ by pronunciation); keep them in sync with the menu bar's
// wake list (utteranceAddressesPane in AiNotifyMenuBar.swift).
const WAKE = ['へい', 'えい', 'うぇい', 'はい', 'ねえ', 'ねぇ', 'おーい', 'おい', 'おっす', 'hey', 'ok'];

// Return the ORIGINAL substring that follows `normName` (a normalized name), with
// the original spacing/case preserved — norm() is lossy (drops spaces, folds
// romaji), so we can't slice the normalized string for free-form dictation.
// foldWithEnds gives both the match-key AND a position map back to the source, so
// we find the name in the key and cut the source right after it. Returns null if
// the name isn't present. (The source is NFKC, matching foldWithEnds.)
const afterName = (original, normName, romaji = true) => {
  if (!normName) return original;
  const composed = String(original).normalize('NFKC');
  const { folded, ends } = foldWithEnds(composed, romaji);
  const pos = folded.indexOf(normName);
  if (pos < 0) return null;
  return composed.slice(ends[pos + normName.length - 1]);
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
  // A bare leading digit is an option ONLY when it's the whole remainder (or N番 /
  // N番目). Unlike a Latin letter, a digit routinely STARTS a free-form sentence
  // as a quantity ("1ヶ月間のログを…", "30件", "3つ") — matching those as "select
  // choice 1/3" silently sent the wrong keystroke instead of typing the command.
  if ((m = /^([1-9])(?:番目?)?$/.exec(rest))) return { index: Number(m[1]) };
  if ((m = /^(えー|びー|しー|でぃー|いー)/.exec(rest))) return { index: KANA_ALPHA[m[1]] };
  if ((m = /^(いち|に|さん|よん|し|ご|ろく|なな|しち|はち)ばん/.exec(rest))) return { index: KANA_NUM[m[1]] };
  return null;
};

const matchesAny = (rest, words) => words.some((w) => rest.startsWith(normLite(w)));

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
export function resolveCommand(spokenText, panes = [], opts = {}) {
  // romaji fold (whisper romanizes Japanese names) helps a JAPANESE speaker but
  // mangles an English one — gate it on the speaker's language (default: on/JA).
  const romaji = opts.romaji !== false;
  const nm = (s) => norm(s, romaji);
  const text = String(spokenText || '').trim();
  if (!text) return fail('empty', '何も聞き取れませんでした');
  const n = nm(text);

  // 1. Pick the target pane. People address a pane the way they'd address a
  //    person: "へい <name>, <command>" — a WAKE WORD, then the name.
  //
  //    The wake word is REQUIRED. Always-on mic means the system also hears
  //    ambient talk AND ai-notify's own read-aloud / the agents' spoken replies
  //    (picked up from the speakers). Acting on any utterance that merely contains
  //    a pane name — or worse, falling back to "the only waiting pane" with no name
  //    at all — let that audio inject itself back into a pane ("完了しました" looping).
  //    Demanding "へい" up front, which neither ambient speech nor TTS produces,
  //    is the gate that stops the feedback loop. No wake word → we never act.
  const named = panes.filter((p) => p.name && nm(p.name));
  const byLen = [...named].sort((a, b) => nm(b.name).length - nm(a.name).length);
  let addr = null;
  for (const w of WAKE) {
    const nw = nm(w);
    if (nw && n.startsWith(nw)) {
      addr = n.slice(nw.length);
      break;
    }
  }
  if (addr === null) return fail('no-wake', '「ヘイ」と名前で呼びかけてください（例:「ヘイ ポール、…」）');

  // The name must come right after the wake word (longest name first, so
  // "ずんだもんアルファ" beats "ずんだもん").
  let target = null;
  let nameHit = '';
  for (const p of byLen) {
    const nn = nm(p.name);
    if (nn && addr.startsWith(nn)) {
      target = p;
      nameHit = nn;
      break;
    }
  }
  if (!target) return fail('no-target', '名前が聞き取れませんでした（「ヘイ <名前>、…」）');
  const confidence = 0.9;

  // 2. Remainder = whatever follows the matched name. Keep BOTH forms: a
  //    normalized one for option/shortcut detection, and the original (spaces +
  //    case preserved) for free-form dictation that gets typed verbatim.
  let origRest = (nameHit ? afterName(text, nameHit, romaji) : text) ?? '';
  origRest = origRest.replace(/^(さん|くん|ちゃん)/, ''); // drop an honorific right after the name
  origRest = origRest.replace(/^[\s、。,.:：・!！?？]+/, ''); // and any separator whisper jammed on ("Paul!Dev"→"Dev")
  const rest = normLite(origRest); // keyword matching: NO romaji fold (see normLite)

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

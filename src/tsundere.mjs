// Tsundere mode: skin the spoken read-out with a tsundere persona whose harshness
// (ツン) ⇄ sweetness (デレ) tracks the event's urgency.
//
//   high urgency (error / failure / dangerous approval)  -> ツン  + louder
//   low  urgency (tests passed / no issues / approved)    -> デレ  (warm)
//
// Everything here is deterministic and offline — phrase banks, no API, no cost.
// The banner (visual) is never skinned; only the spoken text is wrapped.

// --- Urgency classifier ----------------------------------------------------
// We only see the agent's notification text, so urgency is a heuristic. Order
// matters: a "no errors" / "tests passed" message must read as POSITIVE even
// though it contains the word "error".

const POSITIVE =
  /\b(passed|all tests? pass(ed)?|no (issues?|errors?|problems?|failures?)|looks good|lgtm|approved?|success(ful|fully)?|succeeded|completed successfully)\b|✅|問題(は)?(あ?り?ま?せん|な(い|し))|エラー(は)?(あり|出て)?(ま|い)?せん|テスト.*(成功|通過|パス|通り)|レビュー.*(通|問題|OK)|承認|無事(完了|成功)/i;

// Critical = a failure, OR an approval for a DESTRUCTIVE action. A generic
// "permission to run a command" is just a wait (T2) — only destructive verbs /
// dangerous commands escalate to T3.
const CRITICAL =
  /\b(failed|failing|failure|crash(ed|ing)?|exception|panic|fatal|unrecoverable|aborted|broke(n)?|blocked)\b|❌|🛑|\b(permission|approval)\b[^.!?\n]*\b(delete|remove|overwrite|reset|drop|truncate|force|rm)\b|rm\s+-rf|force[- ]?push|git\s+push\s+-f|drop\s+table|truncate\b|エラーが|失敗|クラッシュ|例外が|落ちて|中断され|危険なコマンド/i;

// Returns one of 'T3' (critical) | 'T2' (waiting) | 'T1' (neutral done) | 'T0' (positive).
// `raw` is the agent's original text (pre-translation); `core` is the formatted
// body. We test the raw text first for accuracy.
export const classifyUrgency = (event = 'done', raw = '', core = '') => {
  const text = `${raw || ''} ${core || ''}`;
  if (POSITIVE.test(text) && !CRITICAL.test(text)) return 'T0';
  if (CRITICAL.test(text)) return 'T3';
  if (event === 'waiting') return 'T2';
  return 'T1';
};

// Per-tier modulation: push the baseline tsun level toward ツン (positive bias)
// or デレ (negative bias), and scale the volume. T0 never lowers the volume.
const BIAS = { T3: 0.4, T2: 0.15, T1: 0, T0: -0.4 };
const VOLMUL = { T3: 1.3, T2: 1.1, T1: 1, T0: 1 };

export const effectiveLevel = (level, tier, urgencyShift = true) => {
  const base = Number.isFinite(level) ? level : 0.5;
  return Math.min(1, Math.max(0, base + (urgencyShift ? BIAS[tier] || 0 : 0)));
};

export const volumeMul = (tier, volumeBoost = true) => (volumeBoost ? VOLMUL[tier] || 1 : 1);

// eff >= 0.66 => ツン, <= 0.33 => デレ, else ノーマル. Used for both the phrase
// tone and the VOICEVOX style pick.
export const axisFor = (eff) => (eff >= 0.66 ? 'tsun' : eff <= 0.33 ? 'dere' : 'normal');

// --- Phrase banks ----------------------------------------------------------
// BANK[lang][tone] = { <tier>: [...], default: [...] }. `{body}` is the task
// gist (kept, so the read-out is still informative). Tasteful, short, SFW.

const BANK = {
  ja: {
    tsun: {
      T3: [
        'ちょっと！{body}じゃない。…早く直しなさいよね！',
        'べ、別に心配なんてしてないけど…{body}よ。早くなんとかしなさい！',
        '何やってるのよ、{body}。…ほら、ぼーっとしてないで！',
      ],
      T2: [
        '…{body}。あんたの判断が要るのよ、さっさと決めなさい。',
        'ねえ、{body}。…わたしに聞いてないで早く答えなさいよ。',
      ],
      default: [
        '{body}。…ま、やっておいたわよ。',
        'ふん、{body}。…別にあんたのためじゃないんだからね。',
      ],
    },
    normal: {
      default: ['{body}。', '{body}。…こんなものね。'],
    },
    dere: {
      T0: [
        '{body}…ふふ、よくやったじゃない。べ、別に褒めてないんだからね…えらいえらい。',
        'お疲れさま。{body}だって。…ちゃんとできるのね、見直したわ。',
        '{body}。…うん、いい感じ。その調子よ。',
      ],
      default: ['{body}。…お疲れさま。', '{body}。…ま、悪くないんじゃない。'],
    },
  },
  en: {
    tsun: {
      T3: [
        "Hey! {body}. ...Don't just sit there — fix it!",
        "I-it's not like I was worried, but... {body}. Deal with it, now.",
      ],
      T2: ['...{body}. It needs your call. Hurry up and decide.'],
      default: ['{body}. ...There, I did it. Not for your sake or anything.'],
    },
    normal: { default: ['{body}.', "{body}. ...Well, that's that."] },
    dere: {
      T0: [
        "{body}... heh, not bad at all. N-not that I'm impressed or anything... good job.",
        'Nice work. {body}. ...You actually pulled it off.',
      ],
      default: ['{body}. ...Good work.', "{body}. ...That'll do."],
    },
  },
};

export const isLangSupported = (lang) => !!BANK[lang];

// Wrap `body` with a tsundere line. `rot` rotates phrase choice so repeats vary.
// Unsupported language => body is returned unchanged (volume/voice still apply).
export const wrap = (body, eff, tier, lang = 'ja', rot = 0) => {
  const bank = BANK[lang];
  if (!bank || !body) return body;
  const tone = axisFor(eff);
  const group = bank[tone] || bank.normal;
  const arr = (group && (group[tier] || group.default)) || ['{body}'];
  const phrase = arr[((rot % arr.length) + arr.length) % arr.length];
  return phrase.replace('{body}', body);
};

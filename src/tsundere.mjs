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

// Per-tier modulation: nudge the baseline tsun level toward ツン (positive bias)
// or デレ (negative bias), and scale the volume. Kept small (±0.25) so the
// SLIDER stays in charge — at either extreme the slider wins (even a success
// reads ツン at max, even a failure reads デレ at min); near the middle the
// urgency nudge is what tips the tone. T0 never lowers the volume.
const BIAS = { T3: 0.25, T2: 0.1, T1: 0, T0: -0.25 };
const VOLMUL = { T3: 1.3, T2: 1.1, T1: 1, T0: 1 };

export const effectiveLevel = (level, tier, urgencyShift = true) => {
  const base = Number.isFinite(level) ? level : 0.5;
  return Math.min(1, Math.max(0, base + (urgencyShift ? BIAS[tier] || 0 : 0)));
};

export const volumeMul = (tier, volumeBoost = true) => (volumeBoost ? VOLMUL[tier] || 1 : 1);

// eff >= 0.6 => ツン, <= 0.4 => デレ, else ノーマル. A narrow ノーマル band (only
// the genuinely-neutral middle) so the contrast between ツン and デレ is obvious
// instead of everything collapsing into a bland middle. Used for both the phrase
// tone and the VOICEVOX style pick.
export const axisFor = (eff) => (eff >= 0.6 ? 'tsun' : eff <= 0.4 ? 'dere' : 'normal');

// --- Phrase banks ----------------------------------------------------------
// BANK[lang][tone] = { <tier>: [...], default: [...] }. `{body}` is the task
// gist (kept, so the read-out is still informative). Tasteful, short, SFW.

const BANK = {
  ja: {
    // ツン: 冷たい・とげとげ・素直じゃない。失敗には容赦なく、成功も渋々。
    tsun: {
      T3: [
        'ちょっと！また{body}じゃない。…ぼーっとしてないで早く直しなさいよ！',
        'はぁ？{body}って…どこ見てたのよ。さっさと直す！',
        'べ、別に心配なんてしてないけど…{body}よ。早くなんとかしなさいよね！',
      ],
      T2: [
        '…{body}。あんたの判断待ちなの。さっさと決めなさいよ。',
        'ねえ、{body}でしょ。…わたしに聞いてないで自分で決めなさい。',
      ],
      T1: [
        'ふん、{body}。…言われなくてもやっといたわよ。',
        '{body}。…別にあんたのためじゃないんだからね。',
      ],
      T0: [
        '{body}…ま、まあ及第点ね。べ、別に褒めてないんだからね！',
        'ふん、{body}じゃない。…ちょっとは見直したけど、調子に乗らないでよね。',
      ],
      default: ['{body}。…さっさと次いきなさいよ。'],
    },
    // ノーマル: 中央のニュートラル帯だけ。素っ気なく事実だけ。
    normal: {
      default: ['{body}。', '{body}。…以上よ。'],
    },
    // デレ: あまあま・素直・openly 心配＆応援。失敗にも寄り添う。
    dere: {
      T3: [
        'あっ、{body}…！大丈夫？あわてなくていいから、一緒に直そ？',
        '{body}みたい…。落ち込まないで、ね？あなたならきっと直せるよ。',
      ],
      T2: [
        'ねぇ、{body}だって。…あなたの答え、ここで待ってるね。',
        '{body}…どうするか、ゆっくり決めていいからね。',
      ],
      T1: [
        '{body}、おしまい。…おつかれさま、えらいよ。',
        '{body}。…ちゃんとできてる、すごいね。',
      ],
      T0: [
        '{body}…！やったね、すごいすごい！わたし、ほんとに嬉しい！',
        'わぁ、{body}だって！さすがだなぁ、大好き…！',
        'お疲れさま。{body}…できるって信じてたよ、ほんとえらい！',
      ],
      default: ['{body}。…よくがんばったね。'],
    },
  },
  en: {
    tsun: {
      T3: [
        "Hey! {body} again?! ...Don't just sit there — fix it!",
        'Seriously? {body}. Clean it up, now.',
        "I-it's not like I was worried, but... {body}. Deal with it.",
      ],
      T2: ['...{body}. It needs your call. Hurry up and decide already.'],
      T1: [
        'Hmph. {body}. ...I did it without being asked, obviously.',
        "{body}. ...Not that I did it for you or anything.",
      ],
      T0: [
        "{body}... fine, that's passable. N-not that I'm impressed!",
        'Hmph, {body}. ...A little better, I guess. Don’t let it go to your head.',
      ],
      default: ['{body}. ...Get on with the next one.'],
    },
    normal: { default: ['{body}.', "{body}. ...That's that."] },
    dere: {
      T3: [
        "Oh no, {body}...! Are you okay? Don't panic — let's fix it together, okay?",
        "{body}, huh... Don't be down. You've got this, I know it.",
      ],
      T2: [
        "Hey, {body}. ...I'll be right here waiting for your call.",
        '{body}... take your time deciding, okay?',
      ],
      T1: [
        '{body}, all done. ...Nice work, you did great.',
        "{body}. ...You really pulled it off. I'm proud of you.",
      ],
      T0: [
        "{body}...! You did it! Amazing, amazing! I'm so happy for you!",
        "Wow, {body}! That's incredible — good job!",
        'Nice work. {body}... I always knew you could do it.',
      ],
      default: ['{body}. ...You did your best, well done.'],
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

// --- Delivery / prosody ----------------------------------------------------
// The persona's VOICE, not just its words: how it's spoken, so the read-out has
// human contour instead of a flat 棒読み monotone. Each tone gets its own pace,
// pitch, and intonation range.
//   say.*  : macOS `say` embedded-command deltas, RELATIVE to the voice's own
//            natural setting (rate wpm, pbas pitch base, pmod pitch range) — so
//            it works on any voice without knowing its defaults.
//   vv.*   : VOICEVOX audio_query scales (speed/pitch/intonation; 1.0 = default).
//   espeak : { pitch 0-99, speed wpm } for the Linux fallback.
//   tsun  = quick, higher, sharp swings (agitated scolding).
//   dere  = slower, gentle, wide warm intonation + longer pauses (affectionate).
//   normal= mild, just enough lilt to not sound robotic.
// Kept deliberately SUBTLE: VOICEVOX is already expressive, so over-driving the
// scales (intonation ≫1.2, any pitch shift) is what makes it sound warbly and
// unnatural. The real ツン/デレ contrast comes from the character STYLE
// (ツンツン/あまあま, see voicevox.resolveStyles) — these scales only add a light
// pace/lilt on top, staying inside natural ranges. Same idea for `say`: a small
// pmod, not a big one (heavy pitch-modulation = robotic warble).
const PROSODY = {
  tsun: { say: { rate: 16, pbas: 3, pmod: 3 }, vv: { speed: 1.06, pitch: 0.0, intonation: 1.2 }, espeak: { pitch: 56, speed: 190 } },
  normal: { say: { rate: 0, pbas: 0, pmod: 2 }, vv: { speed: 1.0, pitch: 0.0, intonation: 1.0 }, espeak: { pitch: 50, speed: 175 } },
  dere: { say: { rate: -12, pbas: 1, pmod: 4 }, vv: { speed: 0.96, pitch: 0.0, intonation: 1.1 }, espeak: { pitch: 46, speed: 160 } },
};

export const prosodyFor = (tone) => PROSODY[tone] || PROSODY.normal;

// Combine the user's GUI-tunable BASE scales (the normal-tone values) with this
// tone's nudge, for the VOICEVOX read-out. speed & intonation are scales (they
// multiply), pitch is an offset (it adds). base = {} => pure tone prosody, which
// equals the old behaviour. Returns { speed, pitch, intonation }.
export const effectiveProsody = (tone, base = {}) => {
  const t = prosodyFor(tone).vv;
  const b = { speed: 1, pitch: 0, intonation: 1, ...base };
  return {
    speed: b.speed * t.speed,
    pitch: b.pitch + t.pitch,
    intonation: b.intonation * t.intonation,
  };
};

const sgn = (n) => (n >= 0 ? `+${n}` : `${n}`);

// Wrap spoken text with macOS `say` embedded commands for the given tone, and
// turn ellipses / commas into real beats so the line breathes. Stray `[[`/`]]`
// in the dynamic text is neutralized first so it can't inject its own commands.
export const decorateForSay = (text, tone = 'normal') => {
  if (!text) return text;
  const p = prosodyFor(tone).say;
  const body = String(text)
    .replace(/\[\[|\]\]/g, '') // can't let task text smuggle in commands
    .replace(/[…⋯]+|・・・+|\.{3,}/g, ' [[slnc 220]] ') // a short beat where it trails off
    .replace(/([、,])\s*/g, '$1 [[slnc 70]] '); // commas breathe a touch
  return `[[rate ${sgn(p.rate)}]] [[pbas ${sgn(p.pbas)}]] [[pmod ${sgn(p.pmod)}]] ${body}`;
};

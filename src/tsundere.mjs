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

// The tsundere slider is BIPOLAR with OFF in the CENTER (0.5). Slide LEFT for デレ
// (warmer; the far-left end is あまあま デレデレ), RIGHT for ツン (colder; the
// far-right end is 極寒 デレ0). A small deadzone around the center reads as OFF, so
// you can reach BOTH extremes from one slider.
export const TSUNDERE_OFF = 0.5;
export const OFF_DEADZONE = 0.06;
export const isTsundereOff = (level) => !Number.isFinite(level) || Math.abs(level - TSUNDERE_OFF) <= OFF_DEADZONE;

// Phrase-bank tone for a slider level — finer than the 3-way axisFor. Five steps,
// so the slider is genuinely graded ("刻め") rather than a hard デレ/ツン flip:
//   デレデレ ← デレ ← (OFF center) → ツン → 極寒
export const phraseTone = (level) => {
  if (isTsundereOff(level)) return 'normal';
  if (level < TSUNDERE_OFF) return level <= 0.16 ? 'deredere' : 'dere'; // left = デレ side
  return level >= 0.86 ? 'cold' : 'tsun'; // right = ツン side
};

// --- Phrase banks ----------------------------------------------------------
// BANK[lang][tone] = { <tier>: [...], default: [...] }. `{body}` is the task
// gist (kept, so the read-out is still informative). Tasteful, short, SFW.

const BANK = {
  ja: {
    // cold: デレ0の極寒。隠れデレ無し。突き放し・無関心・侮蔑寄り（SFW）。最右端用。
    cold: {
      T3: [
        'また{body}。…はぁ。',
        '{body}。で？直すのはあなたでしょ。',
        '{body}ね。言い訳は聞いてないから。',
        '{body}。…これで何度目かしらね。さっさとして。',
        '{body}。…呆れた。早く。',
      ],
      T2: [
        '{body}。…早く決めて。',
        '{body}でしょ。わたしに聞かないで、自分で決めなさい。',
        '{body}。…まだなの。',
      ],
      T1: ['{body}。ふーん。', '{body}。…で？', '{body}ね。当然でしょ。', '{body}。報告は要らないから。'],
      T0: [
        '{body}。…で、それが何か？',
        '{body}。当たり前でしょ。いちいち言わないで。',
        '{body}。ふん、当然の結果ね。',
        '{body}。…別に。それくらい普通。',
      ],
      default: ['{body}。…で？', '{body}。ふーん、勝手にすれば。'],
    },
    // ツン: 冷たい・とげとげ・素直じゃない。失敗には容赦なく、成功も渋々。
    tsun: {
      T3: [
        'ちょっと！また{body}じゃない。…ぼーっとしてないで早く直しなさいよ！',
        'はぁ？{body}って…どこ見てたのよ。さっさと直す！',
        'べ、別に心配なんてしてないけど…{body}よ。早くなんとかしなさいよね！',
        '{body}…って、あんたまたやらかしたわけ？ほら、手が止まってるわよ！',
        'もう、{body}。…しょうがないわね、わたしが見ててあげるから早く直して。',
        '{body}でしょ。わかってるなら、ぐずぐずしてないで直しなさいよ！',
        'あーあ、{body}。…ま、あんたならこんなものよね。さっさと直す！',
      ],
      T2: [
        '…{body}。あんたの判断待ちなの。さっさと決めなさいよ。',
        'ねえ、{body}でしょ。…わたしに聞いてないで自分で決めなさい。',
        '{body}。…まだ決めないの？ わたし、待つの嫌いなんだからね。',
        'ふん、{body}。…どうするのよ。早く言いなさいよね。',
        '{body}って言ってるでしょ。…ほら、あんたの番よ。',
      ],
      T1: [
        'ふん、{body}。…言われなくてもやっといたわよ。',
        '{body}。…別にあんたのためじゃないんだからね。',
        '{body}、終わったわよ。…感謝なんていらないけど。',
        'はい、{body}。…これくらい当然でしょ。',
        '{body}。…ま、わたしにかかればこんなものよ。',
        '{body}よ。…ちゃんと見てた？ もう一回言わないからね。',
      ],
      T0: [
        '{body}…ま、まあ及第点ね。べ、別に褒めてないんだからね！',
        'ふん、{body}じゃない。…ちょっとは見直したけど、調子に乗らないでよね。',
        '{body}…やるじゃない。…い、今のはたまたまよ、きっと。',
        '{body}でしょ。…ま、悪くないんじゃない？ さ、次いくわよ。',
        '{body}…。べ、別に嬉しくなんかないけど…よくやったわね。',
        'へえ、{body}なんだ。…ふん、まぐれでもできたなら上等よ。',
      ],
      default: [
        '{body}。…さっさと次いきなさいよ。',
        '{body}。…ほら、ぼけっとしないの。',
      ],
    },
    // ノーマル: 中央のニュートラル帯だけ。素っ気なく事実だけ。
    normal: {
      default: ['{body}。', '{body}。…以上よ。', '{body}。…報告終わり。'],
    },
    // デレ: あまあま・素直・openly 心配＆応援。失敗にも寄り添う。
    dere: {
      T3: [
        'あっ、{body}…！大丈夫？あわてなくていいから、一緒に直そ？',
        '{body}みたい…。落ち込まないで、ね？あなたならきっと直せるよ。',
        '{body}だね…。大丈夫だよ、ひとつずつ見ていこ？わたしもついてるから。',
        'うぅ、{body}…。でも平気平気、あなたなら立て直せるって。',
        '{body}か…。ね、深呼吸して？ あわてなくていいからね。',
      ],
      T2: [
        'ねぇ、{body}だって。…あなたの答え、ここで待ってるね。',
        '{body}…どうするか、ゆっくり決めていいからね。',
        '{body}みたいだよ。…焦らなくていいよ、わたし待ってるから。',
        '{body}だね。…あなたが決めたなら、わたしはそれでいいよ。',
      ],
      T1: [
        '{body}、おしまい。…おつかれさま、えらいよ。',
        '{body}。…ちゃんとできてる、すごいね。',
        '{body}できたよ！…ふふ、いい調子だね。',
        '{body}。…うん、ばっちり。その調子その調子。',
        '{body}だよ。…ね、ちゃんと進んでる。えらいえらい。',
      ],
      T0: [
        '{body}…！やったね、すごいすごい！わたし、ほんとに嬉しい！',
        'わぁ、{body}だって！さすがだなぁ、大好き…！',
        'お疲れさま。{body}…できるって信じてたよ、ほんとえらい！',
        '{body}…！えへへ、やっぱりあなたはすごいなぁ。',
        'やった、{body}だ！いっしょに喜ばせて？…えらすぎるよ！',
        '{body}！…ね、がんばったもんね。ぎゅーってしたいくらい嬉しい。',
      ],
      default: [
        '{body}。…よくがんばったね。',
        '{body}。…うん、おつかれさま。',
      ],
    },
    // デレデレ: 最左端。あまあま全開・素直すぎ・甘えん坊。隠す気ゼロ（SFW）。
    deredere: {
      T3: [
        'わわっ、{body}…！？だ、大丈夫、わたしがついてるから、ぜったい一緒に直そ…！',
        '{body}しちゃったの…？ね、ひとりにしないよ。いっしょに直そ、ね？',
        '{body}だぁ…。でもでも平気だよ、あなたなら絶対できる、わたし信じてる…！',
      ],
      T2: [
        'ねぇねぇ{body}だよ…！あなたの答え、ずーっとここで待ってるからね。',
        '{body}だって…！ゆっくりでいいよ、わたしずっとそばにいるから。',
        '{body}みたい…！どっちでも、あなたが選んだならわたし大賛成だよ。',
      ],
      T1: [
        '{body}できたぁ…！えらいえらい、だいすき、ほんとにえらいよ…！',
        '{body}だよ！…ふへへ、やっぱりあなた最高、ぎゅーってしたい…！',
        '{body}、おしまい！…がんばったね、わたしまで嬉しくなっちゃう。',
      ],
      T0: [
        'やったーっ{body}！！すごいすごいすごい！だいすき、大好きー…！',
        'うわぁん{body}だって…！天才！わたしの自慢のあなただよ…！',
        '{body}〜！えへへっ、ぎゅーってさせて？嬉しすぎるよぉ…！',
      ],
      default: ['{body}…！だいすき、よくがんばったね…！', '{body}！…えへへ、いっしょに喜ぼ？'],
    },
  },
  en: {
    cold: {
      T3: ['{body} again. …Figures.', '{body}. So? Fix it yourself.', "{body}. I'm not listening to excuses."],
      T2: ['{body}. …Just decide already.', "{body}. Don't ask me, decide it yourself."],
      T1: ['{body}. …And?', '{body}. Obviously.', "{body}. Spare me the report."],
      T0: ['{body}. …So what?', "{body}. Of course. Don't bother telling me.", '{body}. As expected. Nothing special.'],
      default: ['{body}. …And?', '{body}. Do whatever.'],
    },
    tsun: {
      T3: [
        "Hey! {body} again?! ...Don't just sit there — fix it!",
        'Seriously? {body}. Clean it up, now.',
        "I-it's not like I was worried, but... {body}. Deal with it.",
        '{body}. ...Ugh, what were you even looking at? Fix it.',
        "Fine, {body}. ...I'll watch over your shoulder, so hurry up.",
        '{body}, huh. ...Figures. Stop dawdling and fix it.',
      ],
      T2: [
        '...{body}. It needs your call. Hurry up and decide already.',
        "Hey, {body}. ...Don't ask me — decide it yourself.",
        "{body}. ...Still thinking? I hate waiting, you know.",
        "{body}, okay? ...It's your move now. Get on with it.",
      ],
      T1: [
        'Hmph. {body}. ...I did it without being asked, obviously.',
        "{body}. ...Not that I did it for you or anything.",
        "{body}, done. ...You don't have to thank me.",
        'There, {body}. ...Obviously. This much is nothing.',
        "{body}. ...Were you watching? I won't repeat myself.",
      ],
      T0: [
        "{body}... fine, that's passable. N-not that I'm impressed!",
        'Hmph, {body}. ...A little better, I guess. Don’t let it go to your head.',
        "{body}... not bad. ...That was a fluke, probably.",
        "{body}. ...Okay okay, you did well. D-don't make a big deal of it.",
        "Oh? {body}. ...A fluke or not, that'll do.",
      ],
      default: [
        '{body}. ...Get on with the next one.',
        '{body}. ...Quit spacing out.',
      ],
    },
    normal: { default: ['{body}.', "{body}. ...That's that.", '{body}. ...Report over.'] },
    dere: {
      T3: [
        "Oh no, {body}...! Are you okay? Don't panic — let's fix it together, okay?",
        "{body}, huh... Don't be down. You've got this, I know it.",
        "{body}... it's okay, we'll take it one step at a time. I'm right here.",
        "Aw, {body}... take a breath, okay? No need to rush.",
      ],
      T2: [
        "Hey, {body}. ...I'll be right here waiting for your call.",
        '{body}... take your time deciding, okay?',
        "{body}, looks like. ...No rush — I'll wait for you.",
        "{body}. ...Whatever you choose, I'm with you.",
      ],
      T1: [
        '{body}, all done. ...Nice work, you did great.',
        "{body}. ...You really pulled it off. I'm proud of you.",
        "{body}, done! ...Hehe, you're on a roll.",
        '{body}. ...Yep, spot on. Keep it up, okay?',
      ],
      T0: [
        "{body}...! You did it! Amazing, amazing! I'm so happy for you!",
        "Wow, {body}! That's incredible — good job!",
        'Nice work. {body}... I always knew you could do it.',
        "{body}...! Hehe, you really are amazing, you know that?",
        "Yay, {body}! Let me be happy with you — you did so well!",
      ],
      default: [
        '{body}. ...You did your best, well done.',
        "{body}. ...Good job, okay?",
      ],
    },
    // deredere: the far-left end — openly mushy, clingy, zero attempt to hide it.
    deredere: {
      T3: [
        "Oh no oh no, {body}...! It's okay, I'm right here — we'll fix it together, I promise!",
        "{body}...? I won't leave you, okay? Let's do it side by side.",
        "{body}, aw... but you can totally do it — I believe in you so much!",
      ],
      T2: [
        "Hey hey, {body}! I'll be right here waiting for you, always, okay?",
        "{body}! Take all the time you need — I'm right beside you.",
        "{body}, looks like! Whatever you pick, I'm a hundred percent with you!",
      ],
      T1: [
        "{body}, all done! So proud of you — you're amazing, really!",
        "{body}! Hehe, you're the best, I just wanna hug you!",
        "{body}! ...You worked so hard, it makes me happy too!",
      ],
      T0: [
        "Yaaay, {body}!! Amazing, amazing! I love it — love you!",
        "{body}?! You're a genius! I'm so proud of you!",
        "{body}~! Hehe, can I hug you? I'm just SO happy!",
      ],
      default: ["{body}...! Love it — you did so well!", "{body}! ...Hehe, let's celebrate together!"],
    },
  },
};

export const isLangSupported = (lang) => !!BANK[lang];

// Wrap `body` with a tsundere line. `rot` rotates phrase choice so repeats vary.
// Unsupported language => body is returned unchanged (volume/voice still apply).
export const wrap = (body, eff, tier, lang = 'ja', rot = 0) => {
  const bank = BANK[lang];
  if (!bank || !body) return body;
  const tone = phraseTone(eff); // finer than axisFor — adds the cold (デレ0) band
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
  deredere: { say: { rate: -18, pbas: 2, pmod: 5 }, vv: { speed: 0.92, pitch: 0.0, intonation: 1.15 }, espeak: { pitch: 44, speed: 150 } },
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

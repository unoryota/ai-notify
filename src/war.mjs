// 心理的安全性 (psychological safety): skin the spoken read-out as a WORKPLACE
// whose management style runs from an exploitative BLACK company to a gentle,
// high-psychological-safety WHITE company. A BIPOLAR slider with OFF in the CENTER:
//
//   left  (→0)  : ブラック企業 — 詰める鬼上司 / 残業強要 (oppressive, SFW satire)
//   center(0.5) : OFF (plain read-out)
//   right (→1)  : ホワイト企業 — kind, supportive, "無理しないでね"
//
// Distance from center = intensity. Deterministic, offline, SFW. Like
// tsundere.mjs, only the spoken text is wrapped; the desktop banner stays
// factual. (Internally still called "war" — the state keys / API name predate
// the rename; the user-facing label everywhere is 心理的安全性 / ブラック⇔ホワイト.)

export const PSAFETY_OFF = 0.5;
export const OFF_DEADZONE = 0.06;
export const isOff = (level) => !Number.isFinite(level) || Math.abs(level - PSAFETY_OFF) <= OFF_DEADZONE;

// Slider level → { mode, intensity 0..1 }. center = off; left = black (harsher
// toward 0); right = white (kinder toward 1).
export const modeOf = (level) => {
  if (isOff(level)) return { mode: 'off', intensity: 0 };
  if (level < PSAFETY_OFF) return { mode: 'black', intensity: Math.min(1, (PSAFETY_OFF - level) / PSAFETY_OFF) };
  return { mode: 'white', intensity: Math.min(1, (level - PSAFETY_OFF) / (1 - PSAFETY_OFF)) };
};

// Two graded steps per side, picked by intensity:
//   black: crunch (mild 詰め上司) → sweat (extreme ガチブラック) at the far left
//   white: kind (mild 優しい)     → zen   (extreme ホワイト)     at the far right
const stepOf = (mode, intensity) =>
  mode === 'black' ? (intensity >= 0.6 ? 'sweat' : 'crunch') : mode === 'white' ? (intensity >= 0.6 ? 'zen' : 'kind') : 'off';

// The VOICEVOX speaking style + tsundere prosody layer this side maps to: black
// is harsh (ツンツン), white is warm (あまあま).
export const styleFor = (level) => {
  const { mode } = modeOf(level);
  return mode === 'black' ? 'tsun' : mode === 'white' ? 'dere' : 'normal';
};

// Volume: black gets LOUDER with intensity (up to ~1.4×), white gets a touch
// SOFTER (down to ~0.88×). Urgency (tier) nudges a little on top.
const TIER_VOL = { T3: 1.1, T2: 1.03, T1: 1, T0: 0.99 };
export const volumeMul = (level, tier) => {
  const { mode, intensity } = modeOf(level);
  const m = mode === 'black' ? 1 + 0.4 * intensity : mode === 'white' ? 1 - 0.12 * intensity : 1;
  return m * (TIER_VOL[tier] || 1);
};

// VOICEVOX prosody nudge, scaled by intensity and combined on top of the user's
// base scales + the tone's own speed. Kept SMALL so it never turns into a 早口:
// black is a touch faster + sharper, white is slower + warmer.
export const effectiveProsody = (level, base = {}) => {
  const { mode, intensity } = modeOf(level);
  const b = { speed: 1, pitch: 0, intonation: 1, ...base };
  let s = { speed: 1, pitch: 0, intonation: 1 };
  if (mode === 'black') s = { speed: 1 + 0.08 * intensity, pitch: 0.02 * intensity, intonation: 1 + 0.18 * intensity };
  else if (mode === 'white') s = { speed: 1 - 0.08 * intensity, pitch: 0.0, intonation: 1 + 0.05 * intensity };
  return { speed: b.speed * s.speed, pitch: b.pitch + s.pitch, intonation: b.intonation * s.intonation };
};

// BANK[lang][step][tier] = [lines]. `{body}` keeps the task gist. black steps push
// (SFW black-company satire); white steps reassure. Tiers: T3 fail / T2 wait / T1 done / T0 win.
const BANK = {
  ja: {
    // ブラック企業・詰める上司（中）
    crunch: {
      T3: ['{body}。は？それ今日中に直して。残業してでも。', '{body}？言い訳はいいから巻きで。', '{body}。詰めが甘い。やり直し、急いで。'],
      T2: ['{body}。判断はそっちの仕事でしょ、早く。', '{body}。手、止まってるよ？回して。', '{body}。報告を待つ時間ないから、進めて。'],
      T1: ['{body}。で、当たり前だよね。次。', '{body}。それくらい普通。気を抜かないで。', '{body}。はい次いこ、止まらないで。'],
      T0: ['{body}。…まあ及第点。でも満足しないで。', '{body}か。合格ね。次はもっと上げて。', '{body}。やればできるじゃん。気を抜かないで。'],
    },
    // ガチのブラック企業（超ハード・最左端）
    sweat: {
      T3: ['{body}！？は？今すぐ直して、終わるまで帰れると思わないで！', '{body}！どうすんのこれ、巻きで巻きで！', '{body}！言い訳は評価に響くよ、すぐ対応！'],
      T2: ['{body}！迷ってる暇ある？即決して、今！', '{body}！そっちの判断待ち、早く回して！', '{body}！手を止めない、とにかく前に！'],
      T1: ['{body}！当然でしょ、休まず次！', '{body}！その程度で満足しないで、続行！', '{body}！はい次、スピード上げて！'],
      T0: ['{body}！…ほー、やるじゃん。で、慢心しないで！', '{body}！合格。即、次のタスク入って！', '{body}！いいね、でも気を緩めないで！'],
    },
    // ホワイト企業・優しい上司（中）
    kind: {
      T3: ['{body}みたいですね。大丈夫、一緒に直していきましょう、焦らずに。', '{body}とのこと。気にしないで、ここから立て直せますよ。', '{body}ですね。責めたりしないので、状況を共有してもらえますか？'],
      T2: ['{body}だそうです。あなたのペースで決めて大丈夫ですよ。', '{body}ですね。急がなくていいので、考えがまとまったら教えてください。', '{body}とのこと。判断はお任せします、いつでもどうぞ。'],
      T1: ['{body}、完了ですね。おつかれさまです、助かりました。', '{body}できましたね。いいペースです、無理はしないで。', '{body}。ありがとうございます、ちゃんと進んでますよ。'],
      T0: ['{body}！素晴らしいですね、さすがです。', '{body}とのこと、お見事です！ありがとうございます。', '{body}！助かりました、本当にお疲れさまでした。'],
    },
    // 心理的安全性MAX・超ホワイト（最右端）
    zen: {
      T3: ['{body}があったんですね。全然大丈夫ですよ、まずは深呼吸して。失敗は責任じゃなく学びですから、一緒にいきましょう。', '{body}とのこと。あなたは悪くないです。落ち着いて、できるところからで大丈夫。', '{body}ですね。安心してください、ここは何を言っても大丈夫な場です。ゆっくりで。'],
      T2: ['{body}だそうです。どう決めても尊重しますので、安心して選んでくださいね。', '{body}ですね。せかしません。あなたが気持ちよく進められるのが一番です。', '{body}とのこと。いつでも待ってます。無理だけはしないでくださいね。'],
      T1: ['{body}、完了ですね。本当におつかれさまでした。ちゃんと休んでくださいね。', '{body}できましたね。素敵です。あなたのペースが一番いいですよ。', '{body}。ありがとうございます。あなたがいてくれて助かっています。'],
      T0: ['{body}！最高です、本当に素晴らしい。あなたを誇りに思います。', '{body}とのこと、すごいです！…ご無理なさってませんか？休んでくださいね。', '{body}！大成功ですね。お祝いさせてください、本当にお見事でした。'],
    },
  },
  en: {
    crunch: {
      T3: ['{body}. Fix it today — stay late if you have to.', '{body}? Skip the excuses, pick up the pace.', '{body}. Sloppy. Redo it, fast.'],
      T2: ['{body}. Deciding is your job — quickly.', "{body}. You've stalled — keep it moving.", '{body}. No time to wait on a report. Go.'],
      T1: ['{body}. Obviously. Next.', "{body}. That's just baseline. Stay on it.", "{body}. Next — don't stop."],
      T0: ["{body}. …Passable. Don't get comfortable.", '{body}. Fine, you pass. Aim higher.', '{body}. See, you can do it. Stay sharp.'],
    },
    sweat: {
      T3: ["{body}?! Fix it now — don't even think about leaving till it's done!", "{body}! What's the plan?! Move, move!", '{body}! Excuses go on your review — handle it!'],
      T2: ['{body}! No time to dither — decide, NOW!', '{body}! Waiting on your call — hurry up!', "{body}! Don't stop — push it forward!"],
      T1: ['{body}! Obviously. No break — next!', "{body}! Don't get satisfied — keep going!", '{body}! Next — pick up the speed!'],
      T0: ["{body}! …Huh, not bad. Don't get cocky!", '{body}! Pass. Straight to the next task!', "{body}! Good — don't let up!"],
    },
    kind: {
      T3: ["{body}, looks like. It's okay — let's fix it together, no rush.", '{body}, I hear. Don’t worry, we can recover from here.', "{body}. No blame here — can you share what's going on?"],
      T2: ['{body}. Decide at your own pace, no pressure.', "{body}. No rush — let me know once you've thought it through.", "{body}. Your call entirely — whenever you're ready."],
      T1: ['{body}, done. Nice work, thank you — that helped.', '{body}, done. Good pace; please don’t overdo it.', '{body}. Thanks — you’re making solid progress.'],
      T0: ['{body}! Wonderful — really well done.', '{body} — fantastic work, thank you!', '{body}! That helped a lot. Great job, truly.'],
    },
    zen: {
      T3: ["{body} happened. It's completely okay — take a breath. Failure is learning, not fault. We'll go through it together.", "{body}. You're not to blame. Take your time, start wherever feels manageable.", "{body}. You're safe here — anything you say is fine. No rush at all."],
      T2: ['{body}. Whatever you choose, I support it — pick what feels right.', "{body}. No pressure ever. What matters is that you're comfortable.", "{body}. I'll wait as long as you need. Just please don't push too hard."],
      T1: ['{body}, done. Thank you so much — please get some rest.', '{body}, done. Lovely. Your own pace is always the best one.', "{body}. Thank you — I'm grateful you're here."],
      T0: ["{body}! Amazing — truly wonderful. I'm proud of you.", '{body} — incredible! …You’re not overworking, are you? Please rest.', '{body}! A real success. Let’s celebrate — wonderful work.'],
    },
  },
};

export const isLangSupported = (lang) => !!BANK[lang];

// Wrap `body` as a 心理的安全性 read-out. `tier` is the urgency the caller already
// classified (T3/T2/T1/T0); `rot` rotates the phrase so repeats vary. OFF (center)
// returns the body unchanged.
export const wrap = (body, level, tier = 'T1', lang = 'ja', rot = 0) => {
  const bank = BANK[lang];
  if (!bank || !body) return body;
  const { mode, intensity } = modeOf(level);
  if (mode === 'off') return body;
  const step = stepOf(mode, intensity);
  const cell = bank[step] || {};
  const arr = cell[tier] || cell.T1 || ['{body}'];
  const phrase = arr[((rot % arr.length) + arr.length) % arr.length];
  return phrase.replace('{body}', body);
};

// 心理的安全性 (psychological safety): skin the spoken read-out as a WORKPLACE
// whose management style runs from an exploitative BLACK company to a gentle,
// high-psychological-safety WHITE company. A BIPOLAR slider with OFF in the CENTER:
//
//   left  (→0)  : ブラック企業 — 詰める鬼上司 / 残業強要 (oppressive, SFW satire)
//   center(0.5) : OFF (plain read-out)
//   right (→1)  : ホワイト企業 — kind, supportive, "無理しないでね"
//
// COMBINES with ツンデレ: the psafety SIDE (black/white) is the environment, and the
// tsundere TONE (ツン / デレ / ノーマル) flavors it — so ブラック×デレ ("優しいけどブラック
// 環境で急かしてくる") differs from ブラック×ツン (冷たく詰める). When tsundere is off the
// tone is ノーマル. Distance from center = intensity → volume + prosody only.
// Deterministic, offline, SFW; only the spoken text is wrapped. (Internally still
// "war" — state keys / API name predate the rename; the label is 心理的安全性.)

export const PSAFETY_OFF = 0.5;
export const OFF_DEADZONE = 0.06;
export const isOff = (level) => !Number.isFinite(level) || Math.abs(level - PSAFETY_OFF) <= OFF_DEADZONE;

// Slider level → { mode (side), intensity 0..1 }. center = off; left = black, right = white.
export const modeOf = (level) => {
  if (isOff(level)) return { mode: 'off', intensity: 0 };
  if (level < PSAFETY_OFF) return { mode: 'black', intensity: Math.min(1, (PSAFETY_OFF - level) / PSAFETY_OFF) };
  return { mode: 'white', intensity: Math.min(1, (level - PSAFETY_OFF) / (1 - PSAFETY_OFF)) };
};

// Default VOICEVOX style for a side when ツンデレ isn't flavoring it: black = harsh
// (ツンツン), white = warm (あまあま).
export const styleFor = (level) => {
  const { mode } = modeOf(level);
  return mode === 'black' ? 'tsun' : mode === 'white' ? 'dere' : 'normal';
};

// Volume: black gets LOUDER with intensity (up to ~1.4×), white a touch SOFTER
// (down to ~0.88×). Urgency (tier) nudges a little on top.
const TIER_VOL = { T3: 1.1, T2: 1.03, T1: 1, T0: 0.99 };
export const volumeMul = (level, tier) => {
  const { mode, intensity } = modeOf(level);
  const m = mode === 'black' ? 1 + 0.4 * intensity : mode === 'white' ? 1 - 0.12 * intensity : 1;
  return m * (TIER_VOL[tier] || 1);
};

// VOICEVOX prosody nudge, scaled by intensity, kept small so it never becomes a
// 早口: black a touch faster + sharper, white slower + warmer.
export const effectiveProsody = (level, base = {}) => {
  const { mode, intensity } = modeOf(level);
  const b = { speed: 1, pitch: 0, intonation: 1, ...base };
  let s = { speed: 1, pitch: 0, intonation: 1 };
  if (mode === 'black') s = { speed: 1 + 0.08 * intensity, pitch: 0.02 * intensity, intonation: 1 + 0.18 * intensity };
  else if (mode === 'white') s = { speed: 1 - 0.08 * intensity, pitch: 0.0, intonation: 1 + 0.05 * intensity };
  return { speed: b.speed * s.speed, pitch: b.pitch + s.pitch, intonation: b.intonation * s.intonation };
};

// BANK[lang][side][tone][tier]. side = black|white (environment), tone =
// tsun|dere|normal (ツンデレ flavor). `{body}` keeps the task gist.
const BANK = {
  ja: {
    black: {
      // ブラック×ツン: 冷たく詰める鬼上司
      tsun: {
        T3: ['{body}。は？言い訳いいから今すぐ直して。残業確定ね。', '{body}？詰めが甘い。やり直し、巻きで。'],
        T2: ['{body}。判断はそっちの仕事でしょ、早く決めて。', '{body}。手、止まってるよ？回して。'],
        T1: ['{body}。で、当然でしょ。次。', '{body}。それくらい普通。気を抜かないで。'],
        T0: ['{body}。…まあ及第点。でも満足しないで。', '{body}か。合格ね。次はもっと上げて。'],
      },
      // ブラック×デレ: 優しいのにブラック環境で急かしてくる（板挟み）
      dere: {
        T3: ['{body}だって…ごめんね、無理させちゃうけど今日中なんだ。一緒に直そ、ね？', '{body}…大丈夫？でも急がなきゃみたいで…ごめん、一緒に頑張ろ？'],
        T2: ['{body}だよ…。ほんとは急かしたくないんだけど、早めにお願いできる…？', '{body}…どうするか教えて？ごめんね、あんまり時間ないみたいなんだ。'],
        T1: ['{body}、できたね！えらい…！休む間もなくてごめん、次いこ？', '{body}！助かる…無理させてごめんね、もうちょっとだけ頑張ろ？'],
        T0: ['{body}！すごい…！こんな環境なのにほんとえらいよ。でも体だけは大事にしてね？', '{body}！やった…！がんばったね、無理させてごめんね…！'],
      },
      // ブラック×ノーマル: 淡々とブラック
      normal: {
        T3: ['{body}。今すぐ直して、終わるまで帰れると思わないで。', '{body}？言い訳は評価に響くよ、すぐ対応。'],
        T2: ['{body}。迷ってる暇ある？即決して。', '{body}。判断待ち、早く回して。'],
        T1: ['{body}。当然でしょ、休まず次。', '{body}。その程度で満足しないで、続行。'],
        T0: ['{body}。…やるじゃん。で、慢心しないで。', '{body}。合格。即、次のタスク。'],
      },
    },
    white: {
      // ホワイト×ツン: 環境は優しいが本人は素直じゃない
      tsun: {
        T3: ['{body}みたいね。…べ、別に心配してないけど、無理しないで直しなさいよ。', '{body}ね。…ま、誰でも失敗はあるし。落ち着いてやれば？'],
        T2: ['{body}でしょ。…急かさないから、自分で決めなさいよね。', '{body}。…ふん、ゆっくりでいいんじゃない。待っててあげる。'],
        T1: ['{body}、終わったの。…ま、ちゃんとやったじゃない。休めば？', '{body}ね。…別に褒めてないけど、無理はしないでよ。'],
        T0: ['{body}…！ま、まあ及第点ね。…ちゃんと休むのよ、別に心配じゃないけど。', '{body}じゃない。…やるわね。無理してないでしょうね？'],
      },
      // ホワイト×デレ: 最ホワイト＋甘々（最高に心理的安全）
      dere: {
        T3: ['{body}があったんですね。全然大丈夫、まずは深呼吸して。一緒にやろ、焦らなくていいからね。', '{body}だね…。あなたは悪くないよ、ゆっくりいこ？'],
        T2: ['{body}だって。どう決めてもいいからね、あなたのペースで。', '{body}だね。せかさないよ、いつでも待ってるから。'],
        T1: ['{body}、完了だね！おつかれさま、えらい…！ちゃんと休んでね。', '{body}できたね。すごい、無理しないでね。'],
        T0: ['{body}！最高…！ほんとすごいよ、大好き！ちゃんと休んでね。', '{body}！やった、誇らしいよ…！お祝いしよ？'],
      },
      // ホワイト×ノーマル: 丁寧で穏やかな上司
      normal: {
        T3: ['{body}みたいですね。大丈夫、一緒に直していきましょう、焦らずに。', '{body}とのこと。責めたりしないので、状況を共有してもらえますか？'],
        T2: ['{body}だそうです。あなたのペースで決めて大丈夫ですよ。', '{body}とのこと。判断はお任せします、いつでもどうぞ。'],
        T1: ['{body}、完了ですね。おつかれさまです、助かりました。', '{body}できましたね。いいペースです、無理はしないで。'],
        T0: ['{body}！素晴らしいですね、さすがです。', '{body}とのこと、お見事です！ありがとうございます。'],
      },
    },
  },
  en: {
    black: {
      tsun: {
        T3: ['{body}. Skip the excuses — fix it now. Overtime it is.', '{body}? Sloppy. Redo it, fast.'],
        T2: ['{body}. Deciding is your job — call it.', "{body}. You've stalled. Keep it moving."],
        T1: ['{body}. Obviously. Next.', "{body}. That's just baseline. Stay sharp."],
        T0: ["{body}. …Passable. Don't get comfortable.", '{body}. You pass. Aim higher.'],
      },
      dere: {
        T3: ["{body}, huh… I'm sorry, I hate to push, but it's due today. Let's fix it together, okay?", "{body}… you okay? We have to hurry though — sorry, let's get through it."],
        T2: ["{body}… I really don't want to rush you, but could you decide soon, please?", "{body}… tell me what you want to do? Sorry, we're short on time."],
        T1: ["{body}, done! Well done…! Sorry there's no break — next?", "{body}! That helps… sorry to push you, just a bit more, okay?"],
        T0: ["{body}! Amazing…! In a place like this, you really did great. Please take care of yourself, though?", "{body}! You did it…! So proud — sorry for the pressure!"],
      },
      normal: {
        T3: ["{body}. Fix it now — don't think about leaving till it's done.", '{body}? Excuses go on your review — handle it.'],
        T2: ['{body}. No time to dither — decide.', '{body}. Waiting on your call — hurry.'],
        T1: ['{body}. Obviously. No break — next.', "{body}. Don't get satisfied — keep going."],
        T0: ["{body}. …Not bad. Don't get cocky.", '{body}. Pass. Straight to the next task.'],
      },
    },
    white: {
      tsun: {
        T3: ["{body}, looks like. …N-not that I'm worried, but take it easy and fix it.", "{body}. …Everyone slips up. Just stay calm, okay?"],
        T2: ["{body}. …I won't rush you, so decide it yourself.", "{body}. …Hmph, take your time. I'll wait."],
        T1: ["{body}, done. …Well, you did fine. Go rest.", "{body}. …Not that I'm praising you, but don't overdo it."],
        T0: ["{body}…! F-fine, that's passable. …Get some rest, not that I care.", "{body}. …Not bad. You're not overworking, are you?"],
      },
      dere: {
        T3: ["{body} happened. It's totally okay — take a breath. Let's do it together, no rush.", "{body}, aw… you're not to blame. Let's go slow, okay?"],
        T2: ['{body}. Whatever you choose is fine — at your own pace.', "{body}. No rush — I'll wait as long as you need."],
        T1: ['{body}, done! Nice work, you did great…! Please get some rest.', "{body}, done. Amazing — don't overdo it, okay?"],
        T0: ["{body}! Wonderful…! Truly amazing, love it! Please rest, okay?", "{body}! You did it — so proud! Let's celebrate?"],
      },
      normal: {
        T3: ["{body}, looks like. It's okay — let's fix it together, no rush.", "{body}. No blame here — can you share what's going on?"],
        T2: ['{body}. Decide at your own pace, no pressure.', "{body}. Your call entirely — whenever you're ready."],
        T1: ['{body}, done. Nice work, thank you — that helped.', '{body}, done. Good pace; please don’t overdo it.'],
        T0: ['{body}! Wonderful — really well done.', '{body} — fantastic work, thank you!'],
      },
    },
  },
};

export const isLangSupported = (lang) => !!BANK[lang];

// Wrap `body` as a 心理的安全性 read-out. `tier` = urgency (T3/T2/T1/T0); `tone` =
// the ツンデレ flavor (tsun|dere|normal, from the tsundere axis, or 'normal' when
// tsundere is off); `rot` rotates the phrase. OFF (center) returns body unchanged.
export const wrap = (body, level, tier = 'T1', lang = 'ja', rot = 0, tone = 'normal') => {
  const bank = BANK[lang];
  if (!bank || !body) return body;
  const { mode } = modeOf(level);
  if (mode === 'off') return body;
  const side = bank[mode] || bank.black;
  const cell = side[tone] || side.normal;
  const arr = cell[tier] || cell.T1 || ['{body}'];
  const phrase = arr[((rot % arr.length) + arr.length) % arr.length];
  return phrase.replace('{body}', body);
};

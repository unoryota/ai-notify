// 心理的安全性 (psychological safety): skin the spoken read-out as a WORKPLACE
// whose management style runs from an exploitative BLACK company to a gentle,
// high-psychological-safety WHITE company. A BIPOLAR slider with OFF in the CENTER:
//
//   left  (→0)  : ブラック企業 — 詰める鬼上司 / 残業強要 (oppressive, SFW satire)
//   center(0.5) : OFF (plain read-out)
//   right (→1)  : ホワイト企業 — kind, supportive, "無理しないでね"
//
// COMBINES with ツンデレ: the psafety SIDE (black/white) is the environment, and the
// tsundere TONE (ツン / デレ / ノーマル) flavors the line — so ブラック×デレ ≠ ブラック×ツン.
// When tsundere is off the tone is ノーマル. Distance from center = intensity →
// volume + prosody only. Deterministic, offline, SFW; only the spoken text is
// wrapped. (Internally still "war" — state keys / API name predate the rename.)

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

// BANK[lang][side][tone][tier] = [lines]. side = black|white (environment), tone =
// tsun|dere|normal (ツンデレ flavor). ~5 JA / ~3 EN lines per cell so variety holds
// up even when locked into one combination. `{body}` keeps the task gist.
const BANK = {
  ja: {
    black: {
      // ブラック×ツン: 冷たく詰める鬼上司
      tsun: {
        T3: [
          '{body}。は？言い訳いいから今すぐ直して。残業確定ね。',
          '{body}？詰めが甘い。やり直し、巻きで。',
          '{body}。…で、どうすんの？早く手を動かして。',
          '{body}でしょ。何回言わせるの。すぐ対応。',
          '{body}。ミスの言い訳より先に直す。今すぐ。',
        ],
        T2: [
          '{body}。判断はそっちの仕事でしょ、早く決めて。',
          '{body}。手、止まってるよ？回して。',
          '{body}。考えてる暇あるなら動いて。',
          '{body}。わたしに聞かないで、自分で決める。',
          '{body}。…まだ？時間は有限なんだけど。',
        ],
        T1: [
          '{body}。で、当然でしょ。次。',
          '{body}。それくらい普通。気を抜かないで。',
          '{body}。はい完了ね、止まらないで次。',
          '{body}。報告は要らないから手を動かす。',
          '{body}。ふーん。で、後ろ詰まってるよ。',
        ],
        T0: [
          '{body}。…まあ及第点。でも満足しないで。',
          '{body}か。合格ね。次はもっと上げて。',
          '{body}。やればできるじゃん。で、気を抜かない。',
          '{body}。悪くない。ただ、それが普通だから。',
          '{body}。…ふん、上出来。慢心しないでよ。',
        ],
      },
      // ブラック×極寒(cold): ツン100% — 隠れデレ一切なし。冷たく突き放す。
      cold: {
        T3: [
          '{body}。…はぁ。で、いつ直るの。',
          '{body}。言い訳は要らない。さっさと直して。',
          '{body}。…呆れた。今すぐ。',
          '{body}。あなたの責任でしょ。直す。',
          '{body}。…で？黙って手を動かして。',
        ],
        T2: [
          '{body}。…早く決めて。',
          '{body}。わたしに聞かないで、自分で。',
          '{body}。…まだ？時間の無駄。',
          '{body}。判断くらい即座に。',
          '{body}。…遅い。',
        ],
        T1: [
          '{body}。ふーん。',
          '{body}。当然。次。',
          '{body}。…で？報告は要らない。',
          '{body}。それで普通でしょ。',
          '{body}。…はい、次。',
        ],
        T0: [
          '{body}。…で、それが何か？',
          '{body}。当たり前でしょ。いちいち言わないで。',
          '{body}。ふん、当然の結果ね。',
          '{body}。…別に。それくらい普通。',
          '{body}。…で？次いって。',
        ],
      },
      // ブラック×デレ: 優しいのにブラック環境で急かしてくる（板挟み）
      dere: {
        T3: [
          '{body}だって…ごめんね、無理させちゃうけど今日中なんだ。一緒に直そ、ね？',
          '{body}…大丈夫？でも急がなきゃみたいで…ごめん、一緒に頑張ろ？',
          '{body}か…。つらいよね。でもここだけ乗り切ろ、わたしも手伝うから。',
          '{body}みたい…。責めないよ、ただ時間がなくて…ごめんね、急ご？',
          '{body}…！落ち着いて、でもごめん、巻きでお願いできる…？そばにいるから。',
        ],
        T2: [
          '{body}だよ…。ほんとは急かしたくないんだけど、早めにお願いできる…？',
          '{body}…どうするか教えて？ごめんね、あんまり時間ないみたいなんだ。',
          '{body}だね。決めるの手伝うよ、でも…そんなに余裕なくてごめん。',
          '{body}みたい。あなたのペースがいいんだけど…今日は急ぎなんだ、ごめんね。',
          '{body}…。无理させてごめん、答えだけ先にもらえる？',
        ],
        T1: [
          '{body}、できたね！えらい…！休む間もなくてごめん、次いこ？',
          '{body}！助かる…無理させてごめんね、もうちょっとだけ頑張ろ？',
          '{body}、完了だね。ありがと…！こんなペースでごめんね、体大事にして。',
          '{body}できたんだ、すごい。…ほんとは休ませたいんだけど、ごめん次もお願い。',
          '{body}！ありがとう…！詰め込みでごめんね、でも助かってるよ。',
        ],
        T0: [
          '{body}！すごい…！こんな環境なのにほんとえらいよ。でも体だけは大事にしてね？',
          '{body}！やった…！がんばったね、無理させてごめんね…！',
          '{body}！さすが…！こんなに急がせちゃってるのに、ほんとありがとう。',
          '{body}…！最高だよ。…ごめんね、ほんとは休んでほしいのに。',
          '{body}！よくやった…！あなたのおかげ。今度こそ少し休も、ね？',
        ],
      },
      // ブラック×ノーマル: 淡々とブラック
      normal: {
        T3: [
          '{body}。今すぐ直して、終わるまで帰れると思わないで。',
          '{body}？言い訳は評価に響くよ、すぐ対応。',
          '{body}。状況は分かった。で、いつ直る？',
          '{body}。手戻りは許容してないから、巻きで。',
          '{body}。原因はあとでいい。先に直す。',
        ],
        T2: [
          '{body}。迷ってる暇ある？即決して。',
          '{body}。判断待ち、早く回して。',
          '{body}。決めるのは君の役割。進めて。',
          '{body}。報告は手短に。次いこ。',
          '{body}。止めないで、判断して前に。',
        ],
        T1: [
          '{body}。当然でしょ、休まず次。',
          '{body}。その程度で満足しないで、続行。',
          '{body}。はい完了。次のタスク。',
          '{body}。記録だけして、手は止めない。',
          '{body}。で、後工程が待ってる。回して。',
        ],
        T0: [
          '{body}。…やるじゃん。で、慢心しないで。',
          '{body}。合格。即、次のタスク。',
          '{body}。基準クリア。続けて。',
          '{body}。よし。休まず次いこう。',
          '{body}。問題なし。スピード維持で。',
        ],
      },
    },
    white: {
      // ホワイト×ツン: 環境は優しいが本人は素直じゃない
      tsun: {
        T3: [
          '{body}みたいね。…べ、別に心配してないけど、無理しないで直しなさいよ。',
          '{body}ね。…ま、誰でも失敗はあるし。落ち着いてやれば？',
          '{body}でしょ。…手伝ってあげてもいいけど。一人で抱えないでよね。',
          '{body}か。…ふん、慌てない慌てない。直せるって。',
          '{body}…。べ、別に気にしてないけど、ちゃんと休憩はさみなさい。',
        ],
        T2: [
          '{body}でしょ。…急かさないから、自分で決めなさいよね。',
          '{body}。…ふん、ゆっくりでいいんじゃない。待っててあげる。',
          '{body}ね。…別に焦らせる気はないから。好きに決めて。',
          '{body}。…どっちでもいいけど。あなたが納得する方にしなさい。',
          '{body}。…待つのは嫌いじゃないし。考えなさい。',
        ],
        T1: [
          '{body}、終わったの。…ま、ちゃんとやったじゃない。休めば？',
          '{body}ね。…別に褒めてないけど、無理はしないでよ。',
          '{body}。…ふん、いい仕事。…って言うと思った？まあ及第点。',
          '{body}できたの。…当然？いや、ちゃんと評価してるけど。',
          '{body}。…お疲れ。べ、別にねぎらってるわけじゃ…まあ休んで。',
        ],
        T0: [
          '{body}…！ま、まあ及第点ね。…ちゃんと休むのよ、別に心配じゃないけど。',
          '{body}じゃない。…やるわね。無理してないでしょうね？',
          '{body}…！べ、別にすごくないし。…でも、ちょっとだけ見直した。',
          '{body}ね。…ふん、上出来。…大事にしてよ、その調子を。',
          '{body}…！し、しっかりやったじゃない。…次も、期待してるから。',
        ],
      },
      // ホワイト×極寒(cold): ツン100% — 環境はホワイトだが本人は無感情・丁寧だが冷徹。隠れデレ無し。
      cold: {
        T3: [
          '{body}ですね。…ご自分で対応を。',
          '{body}とのこと。…で、いつ直りますか。',
          '{body}。…報告は結構です、直してください。',
          '{body}。…さあ。あなたの担当でしょう。',
          '{body}ですか。…お早めに。',
        ],
        T2: [
          '{body}。…ご自分で判断を。',
          '{body}。…で、どちらに。早めに。',
          '{body}とのこと。…私は関与しません。',
          '{body}。…決まりましたら。',
          '{body}。…お早めにどうぞ。',
        ],
        T1: [
          '{body}。…そうですか。',
          '{body}、完了ですね。…以上です。',
          '{body}。…当然の業務かと。',
          '{body}。…次へ。',
          '{body}ですね。…承知しました。',
        ],
        T0: [
          '{body}。…そうですか、結構です。',
          '{body}ですね。…当然の結果かと。',
          '{body}。…特に問題は。次へどうぞ。',
          '{body}。…はい、確認しました。',
          '{body}とのこと。…以上です。',
        ],
      },
      // ホワイト×デレ: 最ホワイト＋甘々（最高に心理的安全）
      dere: {
        T3: [
          '{body}があったんですね。全然大丈夫、まずは深呼吸して。一緒にやろ、焦らなくていいからね。',
          '{body}だね…。あなたは悪くないよ、ゆっくりいこ？',
          '{body}か…。大丈夫、失敗は学びだから。ここから一緒に直そうね。',
          '{body}みたい。落ち込まないで？あなたなら立て直せるって信じてるよ。',
          '{body}…！平気平気、ひとつずつでいいからね。わたしもついてるよ。',
        ],
        T2: [
          '{body}だって。どう決めてもいいからね、あなたのペースで。',
          '{body}だね。せかさないよ、いつでも待ってるから。',
          '{body}…。ゆっくり考えて大丈夫。あなたが選んだならそれが正解だよ。',
          '{body}みたい。迷うよね、わかる。決まったら教えてね、待ってる。',
          '{body}。無理に今決めなくていいよ。あなたの気持ちが一番。',
        ],
        T1: [
          '{body}、完了だね！おつかれさま、えらい…！ちゃんと休んでね。',
          '{body}できたね。すごい、無理しないでね。',
          '{body}！ありがとう…！ちゃんと進んでるよ、いい調子。',
          '{body}だ！えらいえらい。一息ついてね、がんばったから。',
          '{body}、おしまい！…ふふ、さすがだね。お茶でも飲も？',
        ],
        T0: [
          '{body}！最高…！ほんとすごいよ、大好き！ちゃんと休んでね。',
          '{body}！やった、誇らしいよ…！お祝いしよ？',
          '{body}…！わぁ、さすがだなぁ。あなたがいてくれて嬉しい。',
          '{body}！大成功だね…！がんばったもんね、ぎゅーしたいくらい。',
          '{body}！えへへ、やっぱりあなたはすごい。少し休も、ね？',
        ],
      },
      // ホワイト×ノーマル: 丁寧で穏やかな上司
      normal: {
        T3: [
          '{body}みたいですね。大丈夫、一緒に直していきましょう、焦らずに。',
          '{body}とのこと。責めたりしないので、状況を共有してもらえますか？',
          '{body}ですね。慌てなくて大丈夫です。順番に見ていきましょう。',
          '{body}が出たんですね。原因探し、こちらも手伝います。',
          '{body}とのこと。落ち着いて、できるところからで大丈夫ですよ。',
        ],
        T2: [
          '{body}だそうです。あなたのペースで決めて大丈夫ですよ。',
          '{body}とのこと。判断はお任せします、いつでもどうぞ。',
          '{body}ですね。急ぎませんので、まとまったら教えてください。',
          '{body}です。気になる点があれば相談してくださいね。',
          '{body}とのこと。どちらでも問題ありません、お好きに。',
        ],
        T1: [
          '{body}、完了ですね。おつかれさまです、助かりました。',
          '{body}できましたね。いいペースです、無理はしないで。',
          '{body}ですね。ありがとうございます、順調です。',
          '{body}、対応ありがとうございます。ひと休みどうぞ。',
          '{body}完了です。丁寧にやっていただいて助かります。',
        ],
        T0: [
          '{body}！素晴らしいですね、さすがです。',
          '{body}とのこと、お見事です！ありがとうございます。',
          '{body}ですね、完璧です。本当に助かりました。',
          '{body}！見事な仕上がりです。おつかれさまでした。',
          '{body}、大成功ですね。ナイスワークです！',
        ],
      },
    },
  },
  en: {
    black: {
      tsun: {
        T3: ['{body}. Skip the excuses — fix it now. Overtime it is.', '{body}? Sloppy. Redo it, fast.', "{body}. How many times do I have to say it? Handle it."],
        T2: ['{body}. Deciding is your job — call it.', "{body}. You've stalled. Keep it moving.", "{body}. Don't ask me — decide and move."],
        T1: ['{body}. Obviously. Next.', "{body}. That's just baseline. Stay sharp.", "{body}. Done? Good — don't stop."],
        T0: ["{body}. …Passable. Don't get comfortable.", '{body}. You pass. Aim higher.', "{body}. Fine. Don't let it go to your head."],
      },
      cold: {
        T3: ['{body}. …Figures. So when is it fixed?', "{body}. No excuses. Just fix it.", '{body}. …Your responsibility. Handle it.'],
        T2: ['{body}. …Just decide already.', "{body}. Don't ask me — decide it yourself.", '{body}. …Still? Waste of time.'],
        T1: ['{body}. …And?', '{body}. Obviously. Next.', "{body}. …Spare me the report."],
        T0: ['{body}. …So what?', "{body}. Of course. Don't bother telling me.", '{body}. …Nothing special. Next.'],
      },
      dere: {
        T3: ["{body}, huh… I'm sorry, I hate to push, but it's due today. Let's fix it together, okay?", "{body}… you okay? We have to hurry though — sorry, let's get through it.", "{body}… it's rough, I know. Just this stretch — I'll help, I promise."],
        T2: ["{body}… I really don't want to rush you, but could you decide soon, please?", "{body}… tell me what you want to do? Sorry, we're short on time.", "{body}. I'll help you decide — sorry there's so little room today."],
        T1: ["{body}, done! Well done…! Sorry there's no break — next?", "{body}! That helps… sorry to push you, just a bit more, okay?", "{body}, done. Thank you…! Sorry about the pace — take care of yourself."],
        T0: ["{body}! Amazing…! In a place like this, you really did great. Please take care of yourself, though?", "{body}! You did it…! So proud — sorry for the pressure!", "{body}! Incredible — all you. Let's get you a little rest, okay?"],
      },
      normal: {
        T3: ["{body}. Fix it now — don't think about leaving till it's done.", '{body}? Excuses go on your review — handle it.', '{body}. Noted. So when is it fixed?'],
        T2: ['{body}. No time to dither — decide.', '{body}. Waiting on your call — hurry.', '{body}. Deciding is on you. Move it forward.'],
        T1: ['{body}. Obviously. No break — next.', "{body}. Don't get satisfied — keep going.", '{body}. Done. On to the next task.'],
        T0: ["{body}. …Not bad. Don't get cocky.", '{body}. Pass. Straight to the next task.', '{body}. Meets the bar. Keep the pace.'],
      },
    },
    white: {
      tsun: {
        T3: ["{body}, looks like. …N-not that I'm worried, but take it easy and fix it.", "{body}. …Everyone slips up. Just stay calm, okay?", "{body}. …I could help, I guess. Don't carry it alone."],
        T2: ["{body}. …I won't rush you, so decide it yourself.", "{body}. …Hmph, take your time. I'll wait.", "{body}. …Whichever. Pick what you're happy with."],
        T1: ["{body}, done. …Well, you did fine. Go rest.", "{body}. …Not that I'm praising you, but don't overdo it.", "{body}. …Good work. …There, I said it. Now rest."],
        T0: ["{body}…! F-fine, that's passable. …Get some rest, not that I care.", "{body}. …Not bad. You're not overworking, are you?", "{body}…! O-okay, I'm a little impressed. Keep it up."],
      },
      cold: {
        T3: ['{body}. …Please handle it yourself.', '{body}. …So, when will it be fixed?', "{body}. …Spare the report — just fix it."],
        T2: ['{body}. …Decide it yourself.', '{body}. …Which one. Soon, please.', "{body}. …I'm not involved in this."],
        T1: ['{body}. …I see.', "{body}, done. …That's all.", "{body}. …Routine, I'd assume. Next."],
        T0: ['{body}. …I see. Fine.', '{body}. …As expected, I suppose.', '{body}. …No issues. Move on.'],
      },
      dere: {
        T3: ["{body} happened. It's totally okay — take a breath. Let's do it together, no rush.", "{body}, aw… you're not to blame. Let's go slow, okay?", "{body}… it's fine, failure is just learning. We'll fix it together."],
        T2: ['{body}. Whatever you choose is fine — at your own pace.', "{body}. No rush — I'll wait as long as you need.", "{body}. Take your time; whatever you pick is right."],
        T1: ['{body}, done! Nice work, you did great…! Please get some rest.', "{body}, done. Amazing — don't overdo it, okay?", "{body}! Thank you — you're doing great. Breathe."],
        T0: ["{body}! Wonderful…! Truly amazing, love it! Please rest, okay?", "{body}! You did it — so proud! Let's celebrate?", "{body}! Hehe, you really are amazing. Let's take a break, okay?"],
      },
      normal: {
        T3: ["{body}, looks like. It's okay — let's fix it together, no rush.", "{body}. No blame here — can you share what's going on?", "{body}. Take it step by step; I'll help."],
        T2: ['{body}. Decide at your own pace, no pressure.', "{body}. Your call entirely — whenever you're ready.", '{body}. No rush — let me know if you want to talk it through.'],
        T1: ['{body}, done. Nice work, thank you — that helped.', '{body}, done. Good pace; please don’t overdo it.', '{body}. Thanks — going smoothly. Take a breather.'],
        T0: ['{body}! Wonderful — really well done.', '{body} — fantastic work, thank you!', '{body}! Beautifully done. Great job today.'],
      },
    },
  },
};

export const isLangSupported = (lang) => !!BANK[lang];

// Wrap `body` as a 心理的安全性 read-out. `tier` = urgency (T3/T2/T1/T0); `tone` =
// the ツンデレ flavor (tsun|dere|normal); `rot` rotates the phrase. OFF (center)
// returns body unchanged.
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

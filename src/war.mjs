// War mode: skin the spoken read-out as a military operations room. A separate
// axis from tsundere — the WAR LEVEL sets the situation, the tsundere level (if
// on) sets the operator's 好感度 (affection), and the combination picks the line:
//
//   war level   min → 平時 (peacetime, calm radio chatter)
//               mid → 戦闘中 / 第一種戦闘配置 (general quarters, urgent)
//               max → 危機的状況 (no slack — short, shouted)
//   affection   dere (warm) ⇄ normal ⇄ tsun (harsh) — flavors every band
//
// Deterministic, offline, SFW. Like tsundere.mjs, only the spoken text is
// wrapped; the desktop banner stays factual.

import { axisFor } from './tsundere.mjs';

// War situation band from the 0–1 level.
export const band = (level) => {
  const v = Number.isFinite(level) ? level : 0.5;
  if (v < 0.34) return 'peace';
  if (v < 0.67) return 'combat';
  return 'crisis';
};

// Crisis shouts at full volume; combat is raised; peace is normal. Urgency (tier)
// nudges it a little more. Multiplies the user's volume.
const BAND_VOL = { peace: 1.0, combat: 1.18, crisis: 1.4 };
const TIER_VOL = { T3: 1.12, T2: 1.04, T1: 1, T0: 0.98 };
export const volumeMul = (level, tier) => (BAND_VOL[band(level)] || 1) * (TIER_VOL[tier] || 1);

// A VOICEVOX prosody nudge per band (combat/crisis = faster, sharper). Combined
// on top of the user's base scales by effectiveProsody below.
const BAND_PROSODY = {
  peace: { speed: 0.98, pitch: 0.0, intonation: 1.0 },
  combat: { speed: 1.1, pitch: 0.0, intonation: 1.2 },
  crisis: { speed: 1.22, pitch: 0.02, intonation: 1.35 },
};
export const effectiveProsody = (level, base = {}) => {
  const t = BAND_PROSODY[band(level)] || BAND_PROSODY.peace;
  const b = { speed: 1, pitch: 0, intonation: 1, ...base };
  return { speed: b.speed * t.speed, pitch: b.pitch + t.pitch, intonation: b.intonation * t.intonation };
};

// BANK[lang][band][tone] = [lines]. `{body}` keeps the task gist so it stays
// informative. Crisis lines are short and shouted; peace lines are calm.
const BANK = {
  ja: {
    peace: {
      tsun: [
        '司令部より各局。{body}。…別に労ってるわけじゃないけど、引き続き警戒を怠るな。',
        '状況、異常なし。{body}だ。気を抜くんじゃないわよ、当然でしょ。',
        '定時報告。{body}。…ふん、これくらい当たり前。次も抜かりなくね。',
      ],
      normal: [
        '司令部より入電。{body}。現状、戦線は静穏。警戒態勢を維持する。',
        '通信。{body}。各員、配置のまま待機。以上。',
        '定時連絡。{body}。状況に変化なし、平常運転だ。',
      ],
      dere: [
        '司令部より各局へ。{body}だよ。落ち着いてるね、いい調子。少し休んでも大丈夫。',
        '報告ありがと。{body}。今は穏やかだから、ゆっくりいこう？',
        '通信。{body}。順調だね。…無理しないで、そばで見てるから。',
      ],
    },
    combat: {
      tsun: [
        '第一種戦闘配置！{body}よ。ぼーっとしてないで持ち場につきなさい！',
        '総員戦闘配置。{body}。…ヘマしたら承知しないからね、急いで！',
        '戦闘開始。{body}だ。手が止まってるわよ、さっさと動く！',
      ],
      normal: [
        '第一種戦闘配置。{body}。総員、対応急げ。',
        '戦闘配置につけ。{body}。各局、状況を共有し対処せよ。',
        '交戦中。{body}。手順どおり、迅速に。',
      ],
      dere: [
        '第一種戦闘配置だよ！{body}。大丈夫、一緒に乗り切ろう、急いで！',
        '戦闘配置。{body}。落ち着いて、でも急いで。…ちゃんと支えるから。',
        '交戦中だよ。{body}。焦らないで、でも手は止めないで！',
      ],
    },
    crisis: {
      tsun: ['緊急！{body}！早く！', '被弾！{body}！何やってんの、急いで！', '危機的状況！{body}！もたもたしない！'],
      normal: ['緊急事態！{body}！対応急げ！', '警報！{body}！即応せよ！', '危機！{body}！直ちに対処！'],
      dere: ['緊急だよ！{body}！お願い、急いで！', '危ない、{body}！すぐ動こう、今すぐ！', '大変、{body}！一緒に、早く！'],
    },
  },
  en: {
    peace: {
      tsun: ['Command, all stations. {body}. …Not that I care, but stay sharp.', 'Status nominal. {body}. Don’t slack off.'],
      normal: ['Command. {body}. Lines quiet, holding posture.', 'Comms. {body}. All hands, maintain station.'],
      dere: ['Command to all. {body}. Calm out there — nice. Take a breather.', 'Report received. {body}. Steady. Don’t overdo it.'],
    },
    combat: {
      tsun: ['General quarters! {body}. Stop dawdling, to your posts!', 'Battle stations. {body}. Don’t mess this up — move!'],
      normal: ['General quarters. {body}. All hands, respond.', 'Engaged. {body}. By the numbers, quickly.'],
      dere: ['Battle stations! {body}. We’ve got this — hurry!', 'Engaged. {body}. Easy, but keep moving. I’ve got you.'],
    },
    crisis: {
      tsun: ['Emergency! {body}! Now!', 'We’re hit! {body}! Move it!'],
      normal: ['Emergency! {body}! Respond now!', 'Alert! {body}! Immediate action!'],
      dere: ['Emergency! {body}! Please, hurry!', 'It’s bad — {body}! Move, now!'],
    },
  },
};

export const isLangSupported = (lang) => !!BANK[lang];

// Wrap `body` as a war read-out. `affectionEff` is the tsundere effective level
// (0 デレ – 1 ツン); when tsundere is off, pass 0.5 for a neutral operator.
// `rot` rotates the phrase choice so repeats vary.
export const wrap = (body, level, affectionEff = 0.5, lang = 'ja', rot = 0) => {
  const bank = BANK[lang];
  if (!bank || !body) return body;
  const tone = axisFor(affectionEff); // tsun | normal | dere
  const cell = (bank[band(level)] || bank.peace);
  const arr = cell[tone] || cell.normal || ['{body}'];
  const phrase = arr[((rot % arr.length) + arr.length) % arr.length];
  return phrase.replace('{body}', body);
};

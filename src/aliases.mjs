// Infer plausible alternate "readings" for a pane name, so `ai-notify use Paul`
// also answers to ポール / ぽーる without the user spelling each one out.
//
// Best-effort and conservative (only forms we're confident about):
//   - katakana ⇄ hiragana  — exact, always applied (ポール ⇄ ぽーる).
//   - common English given name ⇄ katakana — from a small built-in table.
//     whisper renders a spoken name in EITHER script depending on how it's
//     pronounced, and a romaji fold can't bridge "Paul"→ポール (it gives ぱうる),
//     so a lookup is the only reliable bridge for English-spelled names.
//
// Pure + dependency-free so it's unit-testable (test/aliases.test.mjs).

const kataToHira = (s) => s.replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hiraToKata = (s) => s.replace(/[ぁ-ゔ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const hasKata = (s) => /[ァ-ヴ]/.test(s);
const hasHira = (s) => /[ぁ-ゔ]/.test(s);
const isLatin = (s) => /^[a-z][a-z'’\- ]*$/i.test(s);

// English (lowercase) → katakana. Bidirectional (the reverse map is derived).
// Skewed toward names people actually use as agent labels; extend freely.
// prettier-ignore
const EN_KANA = {
  // Beatles (and the theme this repo's author uses)
  paul: 'ポール', john: 'ジョン', george: 'ジョージ', ringo: 'リンゴ',
  // common given names
  mike: 'マイク', michael: 'マイケル', tom: 'トム', tommy: 'トミー', bob: 'ボブ',
  dave: 'デイブ', david: 'デイビッド', chris: 'クリス', alex: 'アレックス',
  sam: 'サム', ken: 'ケン', tim: 'ティム', jim: 'ジム', joe: 'ジョー',
  jack: 'ジャック', james: 'ジェームズ', jane: 'ジェーン', mary: 'メアリー',
  anna: 'アンナ', anne: 'アン', emma: 'エマ', emily: 'エミリー', kate: 'ケイト',
  lucy: 'ルーシー', lily: 'リリー', max: 'マックス', leo: 'レオ', nick: 'ニック',
  rick: 'リック', rob: 'ロブ', robert: 'ロバート', steve: 'スティーブ',
  pete: 'ピート', peter: 'ピーター', frank: 'フランク',
  henry: 'ヘンリー', harry: 'ハリー', charlie: 'チャーリー', oscar: 'オスカー',
  oliver: 'オリバー', daniel: 'ダニエル', dan: 'ダン', andy: 'アンディ',
  andrew: 'アンドリュー', ben: 'ベン', tony: 'トニー', eric: 'エリック',
  carl: 'カール', gary: 'ゲイリー', adam: 'アダム', ryan: 'ライアン',
  luke: 'ルーク', mark: 'マーク', matt: 'マット', will: 'ウィル',
  // phonetic-alphabet call signs (common for naming parallel agents)
  alpha: 'アルファ', bravo: 'ブラボー', delta: 'デルタ',
  echo: 'エコー', foxtrot: 'フォックストロット',
};

// katakana → first English spelling that maps to it (for the reverse direction).
const KANA_EN = (() => {
  const m = {};
  for (const [en, kata] of Object.entries(EN_KANA)) if (!(kata in m)) m[kata] = en;
  return m;
})();

// Return up to a few inferred readings for `name`, never including `name` itself
// and never an empty/duplicate. Order: kana-fold first, then dictionary forms.
export function inferAliases(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const out = new Set();

  // 1. katakana ⇄ hiragana (exact).
  if (hasKata(raw)) out.add(kataToHira(raw));
  if (hasHira(raw)) out.add(hiraToKata(raw));

  // 2. English given name → katakana (+ its hiragana).
  if (isLatin(raw)) {
    const kata = EN_KANA[raw.toLowerCase()];
    if (kata) {
      out.add(kata);
      out.add(kataToHira(kata));
    }
  } else {
    // 2b. kana name → English spelling (reverse lookup on the katakana form).
    const kata = hasHira(raw) ? hiraToKata(raw) : raw;
    const en = KANA_EN[kata];
    if (en) out.add(en.charAt(0).toUpperCase() + en.slice(1)); // "Paul", not "paul"
  }

  out.delete(raw);
  return [...out].filter(Boolean);
}

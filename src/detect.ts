// @dawn-studio/zh-convert — pure source-language detection + per-part translation decision.
//
// Unicode property escapes (\p{...} with the /u flag, ES2018+) instead of hand-maintained
// hex ranges — they track the Unicode standard automatically (new CJK extensions,
// historic kana, etc. just work).
//
// CRITICAL DISTINCTION: kana/hangul use `Script=` (PRIMARY script), NOT
// `Script_Extensions=`. Script_Extensions includes CJK punctuation shared across scripts
// (。、・「」…), so `Script_Extensions=Hiragana` matches 。and 、 — every normal Chinese
// sentence ("你好。今天天氣很好。") would misdetect as Japanese and the D-04
// Japanese-kanji guard (isChineseLine) would collapse. `Script=` matches only
// characters whose primary script is that script, so shared punctuation stays neutral.
// HAN uses `Script=Han`, which covers ALL CJK extensions (A–I, astral 𠮷 included) —
// the old explicit range only covered Ext-A + the BMP block.
//
// Priority order for detectLang:
//   1. kana (Hiragana/Katakana)  → 'ja'   (wins over Han when mixed)
//   2. hangul (syllables/jamo)   → 'ko'   (wins over Han when mixed)
//   3. Han present, no kana/hangul:
//        simplified-only signal  → 'zh-Hans'
//        traditional-only signal → 'zh-Hant'
//        ambiguous (both/neither)→ 'zh-Hant'  (default Traditional)
//   4. no CJK / Latin-dominant / empty → 'en'
//
// Kanji-only Japanese acceptably misclassifies as Chinese — rare for names/lyrics
// and not worth a dictionary.
//
// Ported from OpenMusic's src/lib/i18n/detect.ts (which used explicit \u ranges;
// upgraded here to property escapes per Hector 2026-10-23).

export type LangTag = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko';

// All Hiragana + Katakana (incl. halfwidth ｦ-ﾝ, phonetic extensions), primary script only.
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
// All Hangul (syllables, compatibility jamo, jamo), primary script only.
const HANGUL = /\p{Script=Hangul}/u;
// ALL CJK Unified Ideographs, every extension (A–I) — astral 𠮷 included.
const HAN = /\p{Script=Han}/u;

// High-frequency SIMPLIFIED-ONLY characters (their traditional form differs).
// ~50 disambiguating chars. Presence ⇒ the text is Simplified Chinese.
const SIMP_ONLY = new Set(
	'简体爱国听乐这会时实当对开关门问题语习书张飞马鸟鱼龙凤'.split('').concat(
		'东车轮转还过远进运动员丰币应学习气长发齐讠忆认让议讯记'.split('')
	)
);

// High-frequency TRADITIONAL-ONLY characters (their simplified form differs).
// ~50 disambiguating chars. Presence ⇒ the text is Traditional Chinese.
const TRAD_ONLY = new Set(
	'繁體愛國聽樂這會時實當對開關門問題語習書張飛馬鳥魚龍鳳'.split('').concat(
		'東車輪轉還過遠進運動員豐幣應學習氣長髮齊訁憶認讓議訊記'.split('')
	)
);

/** Pure source-language classifier. See module header for priority order. */
export function detectLang(text: string): LangTag {
	if (!text) return 'en';
	if (KANA.test(text)) return 'ja';
	if (HANGUL.test(text)) return 'ko';
	if (HAN.test(text)) {
		let simp = false;
		let trad = false;
		for (const ch of text) {
			if (SIMP_ONLY.has(ch)) simp = true;
			else if (TRAD_ONLY.has(ch)) trad = true;
		}
		if (simp && !trad) return 'zh-Hans';
		if (trad && !simp) return 'zh-Hant';
		// both signals OR neither (ambiguous Han) → default Traditional.
		return 'zh-Hant';
	}
	return 'en';
}

/**
 * Per-text-unit decision: should this text be sent to translation for `target`?
 * Pure.
 *   - target === 'off'                  → false (no translation at all)
 *   - detected source ∈ whitelist       → false (render original / pass-through)
 *   - detected source === target        → false (already in target; skip round-trip),
 *     EXCEPT Chinese targets: zh detection rides a small disambiguation char-set, so a
 *     src===target match does NOT prove the text is already in the target script —
 *     misdetected Simplified still routes through the converter (a no-op when already
 *     correct). Opt out by adding the script to the whitelist.
 *   - otherwise                         → true
 */
export function shouldTranslate(text: string, target: string, whitelist: readonly string[]): boolean {
	if (target === 'off') return false;
	const src = detectLang(text);
	if (whitelist.includes(src)) return false;
	if (src === target) {
		// zh detection rides a small disambiguation char-set, so a src===target match does NOT
		// prove the text is already in the target script. For a CHINESE target we fall through
		// and let the caller normalize the script — a no-op when already correct. For en/ja/ko
		// an exact match skips the round-trip. Opt out via the whitelist.
		if (target !== 'zh-Hant' && target !== 'zh-Hans') return false;
	}
	return true;
}

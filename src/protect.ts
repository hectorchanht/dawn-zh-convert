// @dawn-studio/zh-convert — shared word-protection layer.
//
// Words in PROTECTED_WORDS must never be altered by ANY conversion engine
// (tongwen or OpenCC), in any direction. The mechanism: swap each protected
// word for a Private Use Area placeholder before conversion, restore it
// after — PUA chars and digits appear in no conversion dictionary, so the
// placeholders survive every engine untouched.
//
// Extracted from convert.ts in 0.5.0 so the OpenCC path (./opencc.ts) shares
// the exact same protection + 占-normalization as the tongwen path.

/**
 * Words that must NEVER be altered by conversion, in ANY direction
 * (no locale change — the block is script-agnostic).
 *
 * Rationale: tongwen's s2t maps 占 → 佔, but divination vocabulary
 * (占卜/占卦/…) keeps 占 in Traditional. Blocking the single char covers
 * every compound, titles ("陳敬仲占") and verb use ("去占一卦").
 */
export const PROTECTED_WORDS: readonly string[] = ['占'];

// Placeholder wrap for protected words: PUA open/close + slot index. PUA chars
// and digits are in no tongwen dict, so they survive both directions untouched.
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

export function protectWords(
	text: string,
	words: readonly string[]
): { text: string; restore: (s: string) => string } {
	const sorted = [...words].filter(Boolean).sort((a, b) => b.length - a.length);
	let out = text;
	const used: string[] = [];
	for (const w of sorted) {
		if (!out.includes(w)) continue;
		const ph = `${PH_OPEN}${used.length}${PH_CLOSE}`;
		used.push(w);
		out = out.split(w).join(ph);
	}
	if (used.length === 0) return { text, restore: (s: string) => s };
	return {
		text: out,
		restore: (s: string) => {
			let r = s;
			used.forEach((w, i) => {
				r = r.split(`${PH_OPEN}${i}${PH_CLOSE}`).join(w);
			});
			return r;
		}
	};
}

/**
 * s2t 後正規化(繁體路徑限定):
 * 1. 佔 → 占 reverse-normalization for divination compounds.
 *    佔卜/佔卦/… have no legitimate 佔 reading — always a mis-conversion of 占.
 *    佔有/佔領 etc. are untouched. This self-heals text converted BEFORE the
 *    PROTECTED_WORDS block existed (old caches, old records) on re-lock.
 * 2. 占有 → 佔有: the ONE phrase where 占 → 佔 is correct Traditional.
 *    (PROTECTED_WORDS shields 占, so this restores the phrase after conversion.)
 */
export function normalizeZhanS2t(text: string): string {
	return text
		.replace(/佔(?=[卜星卦例辭斷驗夢候法])/g, '占')
		.replace(/([起問善])佔/g, '$1占')
		.replace(/占有/g, '佔有');
}

/**
 * Compounds whose 著 (zhù/zhú reading — "to write / manifest") is CORRECT in
 * Simplified and must never become 着. Listed in BOTH script forms because
 * normalizeZheT2s runs on post-conversion text (mostly Simplified, but a
 * surviving Traditional spelling must also be recognised). NOTE: 合著
 * (co-authored) is deliberately ABSENT — as a bare substring it collides
 * with durative V+著 after 合-final verbs (混合著, 融合著), which is the
 * far more common case in prose; that collision is exactly how the
 * 2026-11-24 miss happened (a protectWords pass shielded 混合著's 著).
 */
export const ZHE_KEEP_COMPOUNDS: readonly string[] = [
	'著名', '著作', '顯著', '显著', '名著', '土著', '著稱', '著称',
	'著述', '著錄', '著录', '編著', '编著', '譯著', '译著', '專著',
	'专著', '論著', '论著', '原著', '巨著', '新著', '遺著', '遗著',
	'著者', '著書', '著书', '著譯', '著译', '著有'
];

const ZHE_KEEP_RE = new RegExp(`(${ZHE_KEEP_COMPOUNDS.join('|')})|著`, 'g');

/**
 * t2s 後正規化(簡體路徑限定):
 * 1. T2S_PHRASE_CORRECTIONS (below): whole-phrase fixes to tongwen's
 *    output (显着 → 显著, 夥伴 → 伙伴).
 * 2. Durative 著 (the zhe particle — V+著, 著呢, 執著, 穿著…) must be 着
 *    in Simplified, but the phrase table only covers some V+著 compounds
 *    (間隔著→间隔着 converts; 混合著 slips through unchanged — found by
 *    the trilingual-blog 驗+改 pass, 2026-11-24). Every 著 outside the
 *    zhù-reading keep-compounds converts to 着.
 * Runs post-conversion; already-Simplified 著名 etc. pass through
 * untouched, and text with no 著/显着 is returned as-is.
 */
/**
 * Whole-phrase t2s corrections: outputs of tongwen's phrase table that are
 * wrong or non-standard in Simplified, fixed at the house layer.
 * - 显着 → 显著 (variant rendering of 顯著; 显著 is the standard form)
 * - 夥伴 → 伙伴 (tongwen leaves 夥 unconverted in this compound; the
 *   Simplified form is 伙伴 — found by the trilingual-blog 驗+改 pass,
 *   human-ai-symbiosis, 2026-11-24)
 */
export const T2S_PHRASE_CORRECTIONS: Readonly<Record<string, string>> = {
	'显着': '显著',
	'夥伴': '伙伴'
};

export function normalizeZheT2s(text: string): string {
	if (!text.includes('著') && !Object.keys(T2S_PHRASE_CORRECTIONS).some((k) => text.includes(k)))
		return text;
	let out = text;
	for (const [from, to] of Object.entries(T2S_PHRASE_CORRECTIONS)) {
		out = out.split(from).join(to);
	}
	return out.replace(ZHE_KEEP_RE, (m, keep) => keep ?? '着');
}

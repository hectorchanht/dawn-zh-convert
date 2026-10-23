// @dawn-studio/zh-convert — lazy client-side Chinese script conversion.
//
// Simplified ⇄ Traditional (zh-Hans ⇄ zh-Hant), phrase-aware and idempotent.
// Engine: tongwen-core (converter) + tongwen-dict (dictionaries), both MIT, declared
// as real dependencies — this package adds the house layer on top:
//
//   - lazy, memoized dict loads via dynamic import() so the ~72 KB s2t / ~22 KB t2s
//     tables stay out of the initial bundle and are fetched at most once;
//   - SYNCHRONOUS handles (published once warm) for no-flash first renders;
//   - an idempotent s2t merge: tongwen's s2t phrase table is keyed on Simplified, so
//     direct s2t of an already-Traditional line like 周杰倫 misses the phrase
//     周杰伦 → 周杰倫 and per-char maps 杰 → 傑 (→ 周傑倫). The merge folds to
//     Simplified first, then per code point keeps the source spelling wherever t2s
//     changed the char (already-Traditional) and takes the phrase-aware s2t of the
//     fold everywhere else;
//   - never-throw boundaries: any import/build/convert failure degrades to IDENTITY
//     (input returned unchanged), never a throw into the caller.
//
// Design decisions (ported from OpenMusic):
//   D-01  Phrase-level conversion (tongwen char + phrase dicts). Phrase quality
//         disambiguates 头发→頭髮 and 里→裡/裏 — char-only libs can't.
//   D-03  Client-side, dict via DYNAMIC import() — out of the initial chunk.
//   D-04  Offline-eligibility rides the kana/hangul-FIRST classifier in ./detect,
//         so Japanese-kanji lines (kana present) are NOT s2t-converted.
//
// Pure .ts: no framework, no browser globals — runs on the edge, in node, and
// under Vitest (deep-import the walker-free tongwen submodules: the top-level
// tongwen-core index eval-time references the DOM global NodeFilter and throws
// where there is no DOM).

import { detectLang } from './detect.js';

// Loads the tongwen engine modules, working around two packaging quirks:
//   1. The top-level `tongwen-core` index eval-time references the DOM global
//      `NodeFilter` — deep-import the walker-free `converter`/`dictionary`
//      submodules instead (both ESM and CJS layouts are walker-free there).
//   2. tongwen-core's ESM uses bare directory imports internally, which plain
//      Node.js ESM rejects — fall back to the CJS build there. The
//      `/* @vite-ignore */` hint keeps bundlers from trying to statically
//      analyze the node:module import (it only ever runs in Node).
interface TongwenEngine {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createConverterMap: (maps: { s2t: any[]; t2s: any[] }) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		phrase: (lang: any, line: string) => string;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	LangType: { s2t: any; t2s: any };
}

async function loadEngine(): Promise<TongwenEngine> {
	try {
		const [converterMod, dictMod] = await Promise.all([
			import('tongwen-core/esm/converter/index.js'),
			import('tongwen-core/esm/dictionary/index.js')
		]);
		return {
			createConverterMap: converterMod.createConverterMap,
			LangType: dictMod.LangType
		};
	} catch {
		const { createRequire } = (await import(/* @vite-ignore */ 'node:module')) as unknown as {
			createRequire: (path: string) => (id: string) => any;
		};
		const require = createRequire(import.meta.url);
		const converterMod = require('tongwen-core/cjs/converter/index.js');
		const dictMod = require('tongwen-core/cjs/dictionary/index.js');
		return {
			createConverterMap: converterMod.createConverterMap,
			LangType: dictMod.LangType
		};
	}
}

// A ready-to-use single-line converter. We memoize THIS (not the raw tongwen Converter)
// so `LangType` stays captured inside the closure and callers never touch tongwen types.
type ConvertLine = (line: string) => string;

// Module-scoped memo: a single dynamic-import + build reused across every call, so the
// s2t dict is fetched at most once for the app's lifetime.
let convertLinePromise: Promise<ConvertLine> | null = null;

// A SYNCHRONOUS handle to the built converter, published once the lazy build resolves.
// Latency-sensitive callers read this to convert zh-Hans→zh-Hant on the FIRST render
// with zero flash — instead of returning Simplified and flipping to Traditional after
// the async debounce+queue. Null until warm.
let convertLineSync: ConvertLine | null = null;

// Lazily import ONLY the s2t (Simplified→Traditional) char + phrase dictionaries plus
// the tongwen engine, then build the phrase-level converter. The tongwen import lives
// ONLY inside these import() calls — a static/top-level import would pull the dict into
// the initial chunk. The `t2s: []` below is NOT a stub — it keeps this map s2t-ONLY so
// an s2t caller never pays for the t2s tables (see buildT2sConvertLine for the mirror).
async function buildConvertLine(): Promise<ConvertLine> {
	// NOTE (node-compat): the `/index.js` suffix and the `{ with: { type: 'json' } }`
	// attribute are required for plain Node.js ESM (directory imports and bare JSON
	// imports throw there); if the ESM build still fails (its internal directory
	// imports), loadEngine falls back to the CJS build. Bundlers (Vite/webpack)
	// accept the same form — the vitest suite exercises that path. String literals
	// are kept (not a helper) so Vite's static analysis still code-splits the dicts.
	const [{ createConverterMap, LangType }, charMod, phraseMod] = await Promise.all([
		loadEngine(),
		import('tongwen-dict/dist/s2t-char.min.json', { with: { type: 'json' } }),
		import('tongwen-dict/dist/s2t-phrase.min.json', { with: { type: 'json' } })
	]);
	// createConverterMap merges the array into length-grouped single/multi maps, so char
	// (len 1) and phrase (len ≥ 2) entries never collide — order is irrelevant.
	const converter = createConverterMap({
		s2t: [charMod.default, phraseMod.default],
		t2s: []
	});
	// `.phrase()` applies the multi-char phrase map AND the single-char map, so it
	// converts both 头发→頭髮 (phrase) and 简体→簡體 (per-char) in one pass.
	return (line: string) => converter.phrase(LangType.s2t, line);
}

function loadConvertLine(): Promise<ConvertLine> {
	if (!convertLinePromise) {
		convertLinePromise = buildConvertLine()
			.then((fn) => {
				// Publish the sync handle so s2tConvertLineSync can convert without awaiting.
				convertLineSync = fn;
				return fn;
			})
			.catch((err) => {
				// Do NOT cache a rejected build — null it so a later call can retry the lazy
				// import (a transient chunk-load failure must not permanently disable conversion).
				convertLinePromise = null;
				throw err;
			});
	}
	return convertLinePromise;
}

/**
 * Fire-and-forget trigger of the lazy dict loads. Call early (e.g. at app boot when
 * the Chinese content target is Traditional) so the converter is WARM before names
 * render — then the sync path succeeds on the first render and there is no flash.
 * Warms BOTH dicts (s2t + t2s) so the idempotent merge is ready at boot. Never throws.
 */
export function warmS2T(): void {
	void warmScript('zh-Hant');
}

/**
 * SYNCHRONOUS Simplified→Traditional for ONE line — the idempotent merge, so
 * already-Traditional input keeps its source spelling (周杰倫 stays 周杰倫).
 * Returns the converted string if the dict is warm, else `null` ("not warm yet" —
 * the caller should warmS2T() and fall back to the async path for this render).
 * Never throws: an empty input or a converter fault returns null (treated as
 * not-ready). Callers MUST gate on isChineseLine() first (this does not re-check).
 */
export function s2tConvertLineSync(text: string): string | null {
	return s2tMerge(text);
}

/**
 * D-04 offline-eligibility predicate: is this line safe to convert offline (Chinese)?
 *
 * Delegates to `detectLang`, which classifies kana→'ja' and hangul→'ko' BEFORE Han —
 * so any line containing kana/hangul returns false and is left alone (the
 * Japanese-kanji guard). Returns true ONLY for detected Chinese ('zh-Hant' |
 * 'zh-Hans'); empty / whitespace / pure-Latin lines detect as 'en' and return false.
 */
export function isChineseLine(text: string): boolean {
	const lang = detectLang(text);
	return lang === 'zh-Hant' || lang === 'zh-Hans';
}

/**
 * Position-aligned batch Simplified→Traditional convert (out.length === lines.length).
 *
 * On the first call the dicts are dynamically imported + built once, then memoized.
 * Each line goes through the idempotent merge; blank lines pass through untouched so
 * alignment and empty slots are preserved (['', '中国'] → ['', '中國']).
 *
 * Never-throw boundary: any import/build/convert failure degrades to IDENTITY (the
 * input lines returned unchanged) rather than throwing into the caller.
 */
export async function s2tConvertLines(lines: string[]): Promise<string[]> {
	if (lines.length === 0) return [];
	try {
		// allSettled, not Promise.all — all would resolve early on a fast t2s failure
		// while s2t is still in flight, and every line would come back unconverted.
		await Promise.allSettled([loadConvertLine(), loadT2sConvertLine()]);
		// s2t failed to load → per-line identity (the never-throw contract above).
		return lines.map((line) => (line ? (s2tConvertLineSync(line) ?? line) : line));
	} catch {
		return lines.slice();
	}
}

// --- The OPPOSITE direction: t2s (Traditional→Simplified) ---------------------------
//
// WHY it exists: a Traditional-script query poisons CN-catalog searches, because those
// catalogs index the SIMPLIFIED name. Production-probed: artist=周傑倫&title=止戰之殤
// misses every tier 3/3 attempts, while the t2s output 周杰伦 / 止战之殇 hits 4/4.
// Convert FIRST and search with the Simplified terms — zero extra latency.
//
// SEPARATE memoized build, deliberately NOT merged into buildConvertLine's one
// createConverterMap call: a merged map would drag s2t's 148 KB phrase dict into the
// bundle for a t2s-only caller (and vice versa). t2s is largely MANY-TO-ONE, so its
// phrase table is ~9× smaller than s2t-phrase (~22 KB gzip total).
let t2sPromise: Promise<ConvertLine> | null = null;

// Deep-import the walker-free `converter` + `dictionary` SUBMODULES (see module header).
async function buildT2sConvertLine(): Promise<ConvertLine> {
	const [{ createConverterMap, LangType }, charMod, phraseMod] = await Promise.all([
		loadEngine(),
		import('tongwen-dict/dist/t2s-char.min.json', { with: { type: 'json' } }),
		import('tongwen-dict/dist/t2s-phrase.min.json', { with: { type: 'json' } })
	]);
	const converter = createConverterMap({
		s2t: [],
		t2s: [charMod.default, phraseMod.default]
	});
	return (line: string) => converter.phrase(LangType.t2s, line);
}

// The t2s twin of `convertLineSync` — a SYNCHRONOUS handle published once the lazy t2s
// build resolves. Null until warm.
let t2sLineSync: ConvertLine | null = null;

function loadT2sConvertLine(): Promise<ConvertLine> {
	if (!t2sPromise) {
		t2sPromise = buildT2sConvertLine()
			.then((fn) => {
				// Publish the sync handle so t2sConvertLineSync can convert without awaiting.
				t2sLineSync = fn;
				return fn;
			})
			.catch((err) => {
				// Never cache a rejected build (the s2t discipline).
				t2sPromise = null;
				throw err;
			});
	}
	return t2sPromise;
}

/**
 * Position-aligned batch Traditional→Simplified convert (out.length === lines.length),
 * mirroring s2tConvertLines exactly. Already-Simplified input is a NO-OP, which lets
 * the caller detect "nothing changed" and skip follow-up work. Never throws —
 * degrades to IDENTITY.
 */
export async function t2sConvertLines(lines: string[]): Promise<string[]> {
	if (lines.length === 0) return [];
	try {
		const convert = await loadT2sConvertLine();
		return lines.map((line) => (line ? convert(line) : line));
	} catch {
		return lines.slice();
	}
}

/**
 * Fire-and-forget trigger of the lazy t2s dict load — the exact mirror of `warmS2T`.
 * Never throws.
 */
export function warmT2S(): void {
	void loadT2sConvertLine().catch(() => {});
}

/**
 * SYNCHRONOUS Traditional→Simplified for ONE line — the exact mirror of
 * `s2tConvertLineSync`, same contract. Returns the converted string once the t2s dict
 * is warm, else `null`. Never throws. Callers MUST gate on isChineseLine() first.
 * Already-Simplified input passes through unchanged.
 */
export function t2sConvertLineSync(text: string): string | null {
	if (!t2sLineSync || !text) return null;
	try {
		return t2sLineSync(text);
	} catch {
		return null;
	}
}

/** The two scripts the lock can force. Deliberately NOT a general language tag — the
 *  lock is a SCRIPT control, not a translation target, and it must never accept
 *  'en'/'ja'/'ko'. */
export type ZhScript = 'zh-Hant' | 'zh-Hans';

/**
 * The idempotent Simplified→Traditional merge. Built on the RAW module handles
 * `convertLineSync` / `t2sLineSync`, never on the exported accessors (those route
 * through here — calling them would recurse).
 *
 * WHY a merge: tongwen's s2t phrase table is keyed on Simplified, so direct s2t of
 * 周杰倫 misses the phrase 周杰伦 → 周杰倫 and per-char maps 杰 → 傑 (→ 周傑倫).
 * Folding to Simplified first and s2t-ing the fold finds the phrase — but a PURE
 * t2s→s2t round trip is lossy on many-to-one chars and corrupts real Traditional
 * names (鍾鎮濤 → 鐘鎮濤, 髮如雪 → 發如雪, 臺灣 → 台灣, lone 髮/乾/麵/隻/鬆 →
 * 發/干/面/只/松). So per code point: a char t2s CHANGED is already a Traditional
 * form and keeps the source's spelling; every other char takes the phrase-aware
 * s2t-of-the-fold.
 *
 * On every probed input the merge equals direct s2t or strictly improves it. t2s
 * cold, or a length mismatch after conversion, returns direct s2t — the old
 * behaviour, never worse.
 */
function s2tMerge(text: string): string | null {
	if (!convertLineSync || !text) return null;
	let direct: string;
	try {
		direct = convertLineSync(text);
	} catch {
		return null; // never-throw: a converter fault reads as "not ready"
	}
	if (!t2sLineSync) return direct;
	try {
		const folded = t2sLineSync(text);
		const round = convertLineSync(folded);
		// Code points, not UTF-16 units: string indexing / split('') would tear astral chars (𠮷).
		const a = Array.from(text);
		const f = Array.from(folded);
		const r = Array.from(round);
		// tongwen phrase maps are length-preserving in practice; this is the never-worse guard.
		if (f.length !== a.length || r.length !== a.length) return direct;
		return a.map((c, i) => (c !== f[i] ? c : r[i])).join('');
	} catch {
		return direct;
	}
}

/**
 * THE script lock. Force one line into `target`'s script, whatever script the
 * upstream returned. The single entry point apps should use; nothing else should
 * reach for a direction-specific sync converter.
 *
 * Order is load-bearing:
 *   1. empty → the input (nothing to convert, and detectLang would answer 'en' anyway);
 *   2. `!isChineseLine(text)` → the input. THIS is the entire "Chinese only, every
 *      other language passes through untouched" guarantee — one classifier, not two
 *      (D-04). KNOWN, ACCEPTED CEILING: a Japanese line with ZERO kana (pure kanji)
 *      detects as Chinese and WILL be converted.
 *   3. dispatch and degrade to the INPUT when a converter answers null: zh-Hant goes
 *      through the `s2tMerge` merge (idempotent on already-Traditional input), zh-Hans
 *      through t2s.
 *
 * Never throws and never returns null: a cold (not yet warm) or faulted converter
 * degrades to IDENTITY, so a first render shows the original text rather than a
 * blank. Callers that care about the cold case should `warmScript(target)` and
 * re-render.
 */
export function lockScriptSync(text: string, target: ZhScript): string {
	if (!text) return text;
	if (!isChineseLine(text)) return text;
	const converted = target === 'zh-Hant' ? s2tMerge(text) : t2sConvertLineSync(text);
	return converted ?? text;
}

/**
 * Await the lazy dict build(s) a lock target needs, swallowing failure. Unlike the
 * fire-and-forget `warmS2T`/`warmT2S`, this hands back a promise so a reactive caller
 * can repaint once the dicts land. Resolves void on success AND on failure — never
 * rejects. zh-Hant awaits BOTH builds (the merge needs t2s too); zh-Hans awaits t2s
 * only. allSettled, NOT Promise.all (a fast single failure must not resolve early
 * while the other build is still in flight).
 */
export async function warmScript(target: ZhScript): Promise<void> {
	try {
		if (target === 'zh-Hant') await Promise.allSettled([loadConvertLine(), loadT2sConvertLine()]);
		else await loadT2sConvertLine();
	} catch {
		/* a failed dict build leaves the sync handle null; lockScriptSync degrades to identity */
	}
}

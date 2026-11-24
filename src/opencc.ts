// @dawn-studio/zh-convert — OpenCC engine path (added in 0.5.0).
//
// A second conversion engine modelled on OpenCC's CONFIG system — the same
// config names/semantics as upstream OpenCC (byvoid/OpenCC) and its online
// converter (https://opencc.js.org/converter?config=s2t):
//
//     import { convertWithConfig, warmConfig } from '@dawn-studio/zh-convert';
//     await convertWithConfig('鼠标', 's2twp'); // → '滑鼠'
//
// Engine implementation: `opencc-js` (the pure-JavaScript port of OpenCC by
// the nk2028 project; dictionaries derived from OpenCC data, MIT AND
// Apache-2.0) — NOT the official `opencc` npm package, which is a native
// addon and cannot run in browsers / on the edge. The house layer on top
// mirrors the tongwen path's discipline exactly:
//
//   - LAZY: opencc-js is loaded via dynamic import() only, memoized per
//     config — it never lands in the initial bundle and is fetched at most
//     once per config;
//   - SYNCHRONOUS handles published once warm (`convertWithConfigSync`
//     returns null while cold — same contract as `s2tConvertLineSync`);
//   - NEVER-THROW: any import/build/convert failure degrades to IDENTITY;
//   - PROTECTED_WORDS apply identically (protect → convert → restore, plus
//     the 占 s2t normalization on Traditional-target configs), via the
//     shared layer in ./protect.ts;
//   - the same Chinese-only guard default as the tongwen path
//     (`opts.guard`, default = the kana/hangul-first classifier).
//
// The DEFAULT engine everywhere else in this package remains tongwen —
// nothing about the pre-0.5.0 API changes behaviour.

import { detectLang } from './detect.js';
import { PROTECTED_WORDS, protectWords, normalizeZhanS2t, normalizeZheT2s } from './protect.js';
import type { ConvertOptions } from './convert.js';

/** Locales an OpenCC config converts between. `cn` = Simplified (Mainland),
 *  `t` = Traditional (OpenCC standard), `tw`/`twp` = Traditional (Taiwan,
 *  `twp` with Taiwan phrases), `hk`/`hkp` = Traditional (Hong Kong, `hkp`
 *  with Hong Kong phrases). These are opencc-js's `from`/`to` values. */
export type OpenCCLocale = 'cn' | 't' | 'tw' | 'twp' | 'hk' | 'hkp';

/** An OpenCC config name — identical naming to upstream OpenCC's preset
 *  configuration files (`s2t.json`, `s2twp.json`, …). */
export type OpenCCConfigName =
	| 's2t'
	| 't2s'
	| 's2tw'
	| 'tw2s'
	| 's2hk'
	| 'hk2s'
	| 's2twp'
	| 'tw2sp'
	| 't2tw'
	| 'tw2t'
	| 't2hk'
	| 'hk2t'
	| 's2hkp'
	| 'hk2sp';

export interface OpenCCConfig {
	name: OpenCCConfigName;
	from: OpenCCLocale;
	to: OpenCCLocale;
	/** Short human label (Traditional Chinese, for UI pickers). */
	label: string;
	/** What the config does, in one line. */
	description: string;
}

/**
 * The OpenCC preset configs, mirroring upstream OpenCC 1.x
 * (`s2t.json` … `hk2sp.json`) and the opencc.js.org converter's `?config=`
 * values. `from`/`to` are the opencc-js locale pair each config stands for.
 */
export const OPENCC_CONFIGS: readonly OpenCCConfig[] = [
	{ name: 's2t', from: 'cn', to: 't', label: '簡體 → 繁體（OpenCC 標準）', description: 'Simplified → Traditional (OpenCC standard)' },
	{ name: 't2s', from: 't', to: 'cn', label: '繁體（OpenCC 標準） → 簡體', description: 'Traditional (OpenCC standard) → Simplified' },
	{ name: 's2tw', from: 'cn', to: 'tw', label: '簡體 → 繁體（台灣）', description: 'Simplified → Traditional (Taiwan standard)' },
	{ name: 'tw2s', from: 'tw', to: 'cn', label: '繁體（台灣） → 簡體', description: 'Traditional (Taiwan standard) → Simplified' },
	{ name: 's2hk', from: 'cn', to: 'hk', label: '簡體 → 繁體（香港）', description: 'Simplified → Traditional (Hong Kong standard)' },
	{ name: 'hk2s', from: 'hk', to: 'cn', label: '繁體（香港） → 簡體', description: 'Traditional (Hong Kong standard) → Simplified' },
	{ name: 's2twp', from: 'cn', to: 'twp', label: '簡體 → 繁體（台灣，含台灣詞彙）', description: 'Simplified → Traditional (Taiwan, with Taiwan phrases: 鼠标→滑鼠)' },
	{ name: 'tw2sp', from: 'twp', to: 'cn', label: '繁體（台灣） → 簡體（含大陸詞彙）', description: 'Traditional (Taiwan) → Simplified (with Mainland phrases: 軟體→软件)' },
	{ name: 't2tw', from: 't', to: 'tw', label: '繁體（OpenCC 標準） → 繁體（台灣）', description: 'Traditional (OpenCC standard) → Traditional (Taiwan standard)' },
	{ name: 'tw2t', from: 'tw', to: 't', label: '繁體（台灣） → 繁體（OpenCC 標準）', description: 'Traditional (Taiwan standard) → Traditional (OpenCC standard)' },
	{ name: 't2hk', from: 't', to: 'hk', label: '繁體（OpenCC 標準） → 繁體（香港）', description: 'Traditional (OpenCC standard) → Traditional (Hong Kong standard)' },
	{ name: 'hk2t', from: 'hk', to: 't', label: '繁體（香港） → 繁體（OpenCC 標準）', description: 'Traditional (Hong Kong standard) → Traditional (OpenCC standard)' },
	{ name: 's2hkp', from: 'cn', to: 'hkp', label: '簡體 → 繁體（香港，含香港詞彙）', description: 'Simplified → Traditional (Hong Kong, with Hong Kong phrases)' },
	{ name: 'hk2sp', from: 'hkp', to: 'cn', label: '繁體（香港） → 簡體（含大陸詞彙）', description: 'Traditional (Hong Kong) → Simplified (with Mainland phrases)' }
];

const CONFIG_BY_NAME = new Map<OpenCCConfigName, OpenCCConfig>(OPENCC_CONFIGS.map((c) => [c.name, c]));

/** Look up a config definition. Unknown runtime strings fall back to 's2t'
 *  (the generic Simplified→Traditional config) instead of throwing. */
export function openccConfig(name: OpenCCConfigName): OpenCCConfig {
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return CONFIG_BY_NAME.get(name) ?? CONFIG_BY_NAME.get('s2t')!;
}

/** True when the config's target is a Traditional locale (everything but
 *  `cn`) — those paths get the 占 s2t normalization, like the tongwen
 *  zh-Hant lock. */
function isTraditionalTarget(config: OpenCCConfigName): boolean {
	return openccConfig(config).to !== 'cn';
}

// --- lazy opencc-js loading -------------------------------------------------

type OpenCCConvertFn = (text: string) => string;

interface OpenCCJsApi {
	Converter: (options: { from: string; to: string }) => OpenCCConvertFn;
}

// Per-config memoized builds + published sync handles (the warmScript /
// convertLineSync pattern from the tongwen path, keyed by config name).
const converterPromises = new Map<OpenCCConfigName, Promise<OpenCCConvertFn>>();
const converterSyncHandles = new Map<OpenCCConfigName, OpenCCConvertFn>();

function loadOpenCCConverter(config: OpenCCConfigName): Promise<OpenCCConvertFn> {
	let p = converterPromises.get(config);
	if (!p) {
		p = (async () => {
			// Dynamic import ONLY — a static import would pull opencc-js's full
			// dictionaries (~1.2 MB) into every consumer's initial bundle.
			const mod = (await import('opencc-js')) as unknown as {
				default?: OpenCCJsApi;
			} & OpenCCJsApi;
			const api: OpenCCJsApi = mod.default ?? mod;
			const cfg = openccConfig(config);
			const fn = api.Converter({ from: cfg.from, to: cfg.to });
			// Publish the sync handle so convertWithConfigSync can convert
			// without awaiting once this build lands.
			converterSyncHandles.set(config, fn);
			return fn;
		})().catch((err) => {
			// Never cache a rejected build — a later call may retry.
			converterPromises.delete(config);
			throw err;
		});
		converterPromises.set(config, p);
	}
	return p;
}

/**
 * Await the lazy opencc-js build for `config` so the sync path is warm.
 * Resolves void on success AND on failure — never rejects (the warmScript
 * contract).
 */
export async function warmConfig(config: OpenCCConfigName): Promise<void> {
	try {
		await loadOpenCCConverter(config);
	} catch {
		/* a failed build leaves the sync handle unset; converters degrade to identity */
	}
}

/** True once `config`'s converter is built and `convertWithConfigSync` can
 *  convert synchronously. */
export function isConfigWarm(config: OpenCCConfigName): boolean {
	return converterSyncHandles.has(config);
}

// --- conversion pipeline ------------------------------------------------------

/** The default guard — identical semantics to convert.ts's isChineseLine
 *  (re-derived from detectLang here to keep the module graph acyclic). */
function defaultGuard(text: string): boolean {
	const lang = detectLang(text);
	return lang === 'zh-Hant' || lang === 'zh-Hans';
}

/** protect → raw-convert → restore → (Traditional target: 占 normalization).
 *  The raw converter returning null (cold/fault) propagates as null. */
function pipeline(
	text: string,
	raw: (t: string) => string | null,
	config: OpenCCConfigName,
	opts?: ConvertOptions
): string | null {
	const words =
		(opts?.protectedWords?.length ?? 0) > 0
			? [...PROTECTED_WORDS, ...(opts?.protectedWords ?? [])]
			: PROTECTED_WORDS;
	const p = protectWords(text, words);
	let out: string | null;
	try {
		out = raw(p.text);
	} catch {
		return null;
	}
	if (out == null) return null;
	const restored = p.restore(out);
	return isTraditionalTarget(config) ? normalizeZhanS2t(restored) : normalizeZheT2s(restored);
}

/**
 * SYNCHRONOUS OpenCC conversion for ONE text (may contain newlines — they
 * pass through the converter untouched). Returns the converted string once
 * `config` is warm (see `warmConfig`), else `null` ("not warm yet").
 * Never throws. Like the tongwen sync converters, this does NOT apply the
 * Chinese-only guard — callers gate first (or use `convertWithConfig`).
 * PROTECTED_WORDS protection DOES apply.
 */
export function convertWithConfigSync(
	text: string,
	config: OpenCCConfigName,
	opts?: ConvertOptions
): string | null {
	if (!text) return null;
	const fn = converterSyncHandles.get(config);
	if (!fn) return null;
	return pipeline(text, (t) => fn(t), config, opts);
}

/**
 * Convert `text` with an OpenCC config (e.g. 's2t', 's2twp', 'hk2s').
 * Lazily loads opencc-js on first use per config; later calls reuse the
 * memoized converter. Processing is per line: each line goes through the
 * guard (default: Chinese only — Japanese/Korean/Latin lines pass through
 * untouched, exactly like the tongwen path), then PROTECTED_WORDS-protected
 * OpenCC conversion.
 *
 * Never throws: any import/build/convert failure degrades to IDENTITY
 * (the input returned unchanged).
 */
export async function convertWithConfig(
	text: string,
	config: OpenCCConfigName,
	opts?: ConvertOptions
): Promise<string> {
	if (!text) return text;
	try {
		await loadOpenCCConverter(config);
	} catch {
		return text;
	}
	const guard = opts?.guard ?? defaultGuard;
	return text
		.split('\n')
		.map((line) => {
			if (!line || !guard(line)) return line;
			return convertWithConfigSync(line, config, opts) ?? line;
		})
		.join('\n');
}

# @dawn-studio/zh-convert

Chinese script conversion for Dawn Studio apps: **Simplified ⇄ Traditional** (phrase-aware, idempotent), lazy-loaded, never-throw. Extracted from OpenMusic's battle-tested `zh-convert` + `i18n/detect` modules.

Default engine: [`tongwen-core`](https://www.npmjs.com/package/tongwen-core) + [`tongwen-dict`](https://www.npmjs.com/package/tongwen-dict) (both MIT) — declared as real dependencies, installed automatically. Since 0.5.0 there is also an **opt-in OpenCC engine** (config-based, see below). This package adds the house layer:

- **Lazy, memoized dict loads** via dynamic `import()` — the ~72 KB s2t / ~22 KB t2s tables stay out of the initial bundle, fetched at most once.
- **Synchronous handles** (`s2tConvertLineSync`, `t2sConvertLineSync`) published once warm — no-flash first renders.
- **Idempotent s2t merge** — tongwen's s2t phrase table is keyed on Simplified, so direct s2t of an already-Traditional 周杰倫 misses the phrase and per-char maps 杰 → 傑 (→ 周傑倫). The merge folds to Simplified first, then per code point keeps the source spelling wherever t2s changed the char.
- **Never-throw** — any import/build/convert failure degrades to identity, never a throw.
- **Japanese guard** — the kana/hangul-first classifier means Japanese lines (kana present) are never wrongly Traditionalized.

## Install

```bash
npm i @dawn-studio/zh-convert
```

## Quick start

```ts
import {
  lockScriptSync,   // force one line into a script — the entry point most apps want
  warmScript,       // await dict builds so the first render doesn't flash
  s2tConvertLines,  // batch Simplified → Traditional (position-aligned)
  t2sConvertLines,  // batch Traditional → Simplified
  isChineseLine,    // predicate: safe to convert offline?
  detectLang,       // pure classifier: en | zh-Hant | zh-Hans | ja | ko
  shouldTranslate,  // per-text-unit "should this be translated?" decision
} from '@dawn-studio/zh-convert';

// 1. Warm early (e.g. app boot) when the target is Traditional:
await warmScript('zh-Hant');

// 2. Force any upstream text into the user's script — Chinese only, everything
//    else passes through untouched, never throws, never returns null:
lockScriptSync('周杰伦', 'zh-Hant'); // → '周杰倫'
lockScriptSync('周杰倫', 'zh-Hant'); // → '周杰倫' (idempotent — source spelling kept)
lockScriptSync('こんにちは', 'zh-Hant'); // → 'こんにちは' (Japanese untouched)
```

Batch conversion (lyrics, search results):

```ts
await s2tConvertLines(['头发', '', '简体中文']); // → ['頭髮', '', '簡體中文']
await t2sConvertLines(['止戰之殤']);              // → ['止战之殇']
```

No-flash sync path for render loops — returns `null` until warm:

```ts
import { warmS2T, s2tConvertLineSync } from '@dawn-studio/zh-convert';
warmS2T(); // fire-and-forget at boot
// ... in render:
const text = s2tConvertLineSync(name) ?? name;
```

## API

| Export | Description |
|---|---|
| `lockScriptSync(text, target, opts?)` | Force one line into `'zh-Hant'`/`'zh-Hans'`. Never throws, never null. **Use this.** |
| `warmScript(target)` | Await the dict build(s) a lock target needs. Never rejects. |
| `s2tConvertLines(lines, opts?)` | Batch s2t, position-aligned, blanks preserved. |
| `t2sConvertLines(lines, opts?)` | Batch t2s, position-aligned. No-op on already-Simplified input. |
| `s2tConvertLineSync(text)` | Sync s2t (idempotent merge). `null` until warm. Gate on `isChineseLine` first. |
| `t2sConvertLineSync(text)` | Sync t2s. `null` until warm. |
| `warmS2T()` / `warmT2S()` | Fire-and-forget warmers. |
| `isChineseLine(text)` | `true` only for detected Chinese — kana/hangul lines return `false`. |
| `detectLang(text)` | Pure classifier → `'en' \| 'zh-Hant' \| 'zh-Hans' \| 'ja' \| 'ko'`. Kana/hangul win over Han; ambiguous Han defaults to `'zh-Hant'`. |
| `shouldTranslate(text, target, whitelist)` | Per-unit translation decision; Chinese targets always route through the converter (detection is unreliable on the small char-set). |
| `convertWithConfig(text, config, opts?)` | **OpenCC path.** Async config-based conversion (per-line guard + protection). Never throws — identity on failure. |
| `convertWithConfigSync(text, config, opts?)` | **OpenCC path.** Sync conversion once warm; `null` while cold. No guard — gate first. |
| `warmConfig(config)` | **OpenCC path.** Await a config's lazy build. Never rejects. |
| `isConfigWarm(config)` | **OpenCC path.** Whether a config's sync handle is ready. |
| `OPENCC_CONFIGS` / `openccConfig(name)` | **OpenCC path.** The preset config table / lookup (unknown names fall back to `s2t`). |

## OpenCC engine (0.5.0+) — config-based conversion

Modelled on [OpenCC](https://github.com/byvoid/opencc)'s preset **config** system — the same config names as upstream OpenCC and the [online converter](https://opencc.js.org/converter?config=s2t) (`?config=s2t`). Implemented with [`opencc-js`](https://www.npmjs.com/package/opencc-js) (the pure-JavaScript port of OpenCC; dictionaries derived from OpenCC data, MIT AND Apache-2.0) — **not** the official `opencc` npm package, which is a native addon and cannot run in browsers or on the edge.

```ts
import { convertWithConfig, convertWithConfigSync, warmConfig, OPENCC_CONFIGS } from '@dawn-studio/zh-convert';

await convertWithConfig('鼠标', 's2twp');        // → '滑鼠' (Taiwan phrases)
await convertWithConfig('軟體', 'tw2sp');        // → '软件' (Mainland phrases)
await warmConfig('s2t');                          // warm the sync handle…
convertWithConfigSync('汉字', 's2t');             // → '漢字' (null while cold)
```

Or route the existing APIs through OpenCC with `ConvertOptions`:

```ts
await s2tConvertLines(['鼠标'], { engine: 'opencc', config: 's2twp' }); // → ['滑鼠']
lockScriptSync('汉字', 'zh-Hant', { engine: 'opencc' }); // sync handle — warmConfig('s2t') first; cold → identity
```

The default engine stays `tongwen`; OpenCC is strictly opt-in. The OpenCC path keeps every house guarantee: lazy per-config loading (dynamic `import()`, never in the initial bundle), never-throw identity fallback, the same Chinese-only guard, and `PROTECTED_WORDS` protection (占 never becomes 佔 on OpenCC paths either; 占有→佔有 still works).

### Config table (upstream OpenCC names ↔ opencc-js locales)

Rough script-lock equivalents: `zh-Hant` ≈ `s2t`, `zh-Hans` ≈ `t2s` — the regional configs (`s2tw`, `s2hk`, …) additionally normalize regional variants/phrases, which the script lock deliberately does not do.

| config | from → to | meaning |
|---|---|---|
| `s2t` | cn → t | Simplified → Traditional (OpenCC standard) |
| `t2s` | t → cn | Traditional (OpenCC standard) → Simplified |
| `s2tw` | cn → tw | Simplified → Traditional (Taiwan standard) |
| `tw2s` | tw → cn | Traditional (Taiwan) → Simplified |
| `s2hk` | cn → hk | Simplified → Traditional (Hong Kong standard) |
| `hk2s` | hk → cn | Traditional (Hong Kong) → Simplified |
| `s2twp` | cn → twp | Simplified → Traditional (Taiwan, with Taiwan phrases: 鼠标→滑鼠, 软件→軟體) |
| `tw2sp` | twp → cn | Traditional (Taiwan) → Simplified (with Mainland phrases: 軟體→软件) |
| `t2tw` | t → tw | Traditional (OpenCC standard) → Traditional (Taiwan) |
| `tw2t` | tw → t | Traditional (Taiwan) → Traditional (OpenCC standard) |
| `t2hk` | t → hk | Traditional (OpenCC standard) → Traditional (Hong Kong) |
| `hk2t` | hk → t | Traditional (Hong Kong) → Traditional (OpenCC standard) |
| `s2hkp` | cn → hkp | Simplified → Traditional (Hong Kong, with Hong Kong phrases) |
| `hk2sp` | hkp → cn | Traditional (Hong Kong) → Simplified (with Mainland phrases; upstream: still developing) |

## ConvertOptions — every knob, your call

`lockScriptSync`, `s2tConvertLines` and `t2sConvertLines` all accept an optional
`opts: ConvertOptions`. Nothing is hardcoded that a reasonable app would want to change:

```ts
import { lockScriptSync, type ConvertOptions } from '@dawn-studio/zh-convert';

// The "Chinese only" rule is just the default guard — replace it freely:
lockScriptSync('こんにちは世界', 'zh-Hant');                                  // → unchanged (default guard)
lockScriptSync('简体', 'zh-Hant', { guard: () => true });                     // → '簡體' (allow all)
lockScriptSync('简体', 'zh-Hant', { guard: (t) => t !== '简体' });            // → '简体' (skip this line)

await s2tConvertLines(['简体', '头发'], { guard: isChineseLine });            // explicit default
```

| option | type | default | notes |
|---|---|---|---|
| `guard` | `(text: string) => boolean` | `isChineseLine` | Rejected lines pass through untouched. The default is the kana/hangul-first classifier — it already does the right thing for mixed-language text. |
| `protectedWords` | `readonly string[]` | — | Extra words shielded from conversion, added to `PROTECTED_WORDS`. |
| `engine` | `'tongwen' \| 'opencc'` | `'tongwen'` | Conversion engine. `'opencc'` routes the async batch converters directly; `lockScriptSync` uses the warm OpenCC sync handle (cold → identity). |
| `config` | `OpenCCConfigName` | `'s2t'` / `'t2s'` per entry point | OpenCC config name; only used when `engine: 'opencc'`. |

## Notes

- Engines & attribution: the tongwen dictionaries are MIT (tongwen-core/tongwen-dict); the OpenCC dictionaries come from OpenCC data via opencc-js (opencc-js is MIT AND Apache-2.0; OpenCC data is Apache-2.0). This package itself is Apache-2.0.
- s2t and t2s dicts are built **separately** — a t2s-only caller never downloads s2t's 148 KB phrase table.
- Deep-imports `tongwen-core/esm/*` (not the top-level index): the index eval-time references the DOM global `NodeFilter` and throws where there is no DOM.
- Known ceiling of the default guard: a Japanese line with **zero kana** (pure kanji) detects as Chinese and will be converted. Override `guard` if your corpus needs stricter screening.

## License

Apache-2.0

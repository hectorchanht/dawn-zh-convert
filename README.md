# @dawn-studio/zh-convert

Chinese script conversion for Dawn Studio apps: **Simplified ⇄ Traditional** (phrase-aware, idempotent), lazy-loaded, never-throw. Extracted from OpenMusic's battle-tested `zh-convert` + `i18n/detect` modules.

Engine: [`tongwen-core`](https://www.npmjs.com/package/tongwen-core) + [`tongwen-dict`](https://www.npmjs.com/package/tongwen-dict) (both MIT) — declared as real dependencies, installed automatically. This package adds the house layer:

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

## Notes

- s2t and t2s dicts are built **separately** — a t2s-only caller never downloads s2t's 148 KB phrase table.
- Deep-imports `tongwen-core/esm/*` (not the top-level index): the index eval-time references the DOM global `NodeFilter` and throws where there is no DOM.
- Known ceiling of the default guard: a Japanese line with **zero kana** (pure kanji) detects as Chinese and will be converted. Override `guard` if your corpus needs stricter screening.

## License

Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import {
	OPENCC_CONFIGS,
	openccConfig,
	convertWithConfig,
	convertWithConfigSync,
	warmConfig,
	isConfigWarm
} from '../src/opencc.js';
import {
	s2tConvertLines,
	t2sConvertLines,
	lockScriptSync,
	warmScript
} from '../src/convert.js';

// OpenCC engine path: config-based conversion via opencc-js (the pure-JS port
// of byvoid/OpenCC). Expected values below were probed against opencc-js
// 1.4.2's actual output, not assumed from the config names.

describe('OPENCC_CONFIGS — the OpenCC preset config table', () => {
	it('lists all 14 upstream OpenCC preset configs', () => {
		expect(OPENCC_CONFIGS.map((c) => c.name)).toEqual([
			's2t',
			't2s',
			's2tw',
			'tw2s',
			's2hk',
			'hk2s',
			's2twp',
			'tw2sp',
			't2tw',
			'tw2t',
			't2hk',
			'hk2t',
			's2hkp',
			'hk2sp'
		]);
	});

	it('maps config names to the opencc-js locale pairs (opencc.js.org semantics)', () => {
		expect(openccConfig('s2t')).toMatchObject({ from: 'cn', to: 't' });
		expect(openccConfig('t2s')).toMatchObject({ from: 't', to: 'cn' });
		expect(openccConfig('s2twp')).toMatchObject({ from: 'cn', to: 'twp' });
		expect(openccConfig('tw2sp')).toMatchObject({ from: 'twp', to: 'cn' });
		expect(openccConfig('hk2t')).toMatchObject({ from: 'hk', to: 't' });
		expect(openccConfig('s2hkp')).toMatchObject({ from: 'cn', to: 'hkp' });
	});
});

describe('convertWithConfig — per-config conversion quality', () => {
	it('s2t: 简体 → OpenCC 標準繁體 (phrase-aware: 头发→頭髮)', async () => {
		expect(await convertWithConfig('汉字', 's2t')).toBe('漢字');
		expect(await convertWithConfig('头发', 's2t')).toBe('頭髮');
		expect(await convertWithConfig('周杰伦', 's2t')).toBe('周杰倫');
	});

	it('s2tw: Taiwan variants (里边→裡邊)', async () => {
		expect(await convertWithConfig('简体中文', 's2tw')).toBe('簡體中文');
		expect(await convertWithConfig('里边', 's2tw')).toBe('裡邊');
	});

	it('s2hk: Hong Kong variants (里边→裏邊)', async () => {
		expect(await convertWithConfig('头发', 's2hk')).toBe('頭髮');
		expect(await convertWithConfig('里边', 's2hk')).toBe('裏邊');
	});

	it('s2twp: Taiwan phrases (鼠标→滑鼠, 自行车→腳踏車, 软件→軟體)', async () => {
		expect(await convertWithConfig('鼠标', 's2twp')).toBe('滑鼠');
		expect(await convertWithConfig('自行车', 's2twp')).toBe('腳踏車');
		expect(await convertWithConfig('软件', 's2twp')).toBe('軟體');
	});

	it('s2hkp: Hong Kong phrases (鼠标→滑鼠)', async () => {
		expect(await convertWithConfig('鼠标', 's2hkp')).toBe('滑鼠');
	});

	it('t2s: 繁體 → 简体', async () => {
		expect(await convertWithConfig('繁體中文', 't2s')).toBe('繁体中文');
		expect(await convertWithConfig('頭髮', 't2s')).toBe('头发');
	});

	it('tw2s: 台灣繁體 → 简体', async () => {
		expect(await convertWithConfig('臺灣', 'tw2s')).toBe('台湾');
		expect(await convertWithConfig('頭髮', 'tw2s')).toBe('头发');
	});

	it('hk2s: 香港繁體 → 简体', async () => {
		expect(await convertWithConfig('頭髮', 'hk2s')).toBe('头发');
		expect(await convertWithConfig('繁體中文', 'hk2s')).toBe('繁体中文');
	});

	it('tw2sp: Taiwan phrases reversed (軟體→软件, 腳踏車→自行车)', async () => {
		expect(await convertWithConfig('軟體', 'tw2sp')).toBe('软件');
		expect(await convertWithConfig('腳踏車', 'tw2sp')).toBe('自行车');
	});

	it('hk2sp: Hong Kong phrases reversed (滑鼠→鼠标)', async () => {
		// Upstream marks hk2sp as still-developing; probed against opencc-js
		// 1.4.2: 滑鼠→鼠标 is a real phrase-level reversal it performs.
		expect(await convertWithConfig('滑鼠', 'hk2sp')).toBe('鼠标');
	});

	it('t2tw / tw2t: standard ⇄ Taiwan variant normalization', async () => {
		expect(await convertWithConfig('裏面', 't2tw')).toBe('裡面');
		expect(await convertWithConfig('裡面', 'tw2t')).toBe('裏面');
	});

	it('t2hk / hk2t: standard ⇄ Hong Kong variant normalization', async () => {
		expect(await convertWithConfig('臺灣', 't2hk')).toBe('台灣');
		expect(await convertWithConfig('台灣', 'hk2t')).toBe('臺灣');
	});

	it('passes non-Chinese lines through untouched (default guard)', async () => {
		expect(await convertWithConfig('Hello World', 's2t')).toBe('Hello World');
		expect(await convertWithConfig('こんにちは世界', 's2t')).toBe('こんにちは世界');
		expect(await convertWithConfig('', 's2t')).toBe('');
	});

	it('converts multi-line text per line, preserving blank lines', async () => {
		expect(await convertWithConfig('汉字\n\n头发', 's2t')).toBe('漢字\n\n頭髮');
	});
});

describe('PROTECTED_WORDS on the OpenCC path', () => {
	it('占 never becomes 佔 (占卜/占例 stay), in the s2t direction', async () => {
		expect(await convertWithConfig('占卜结果', 's2t')).toBe('占卜結果');
		expect(await convertWithConfig('易经占例', 's2t')).toBe('易經占例');
	});

	it('占有 → 佔有 still works (the one legitimate 佔 phrase, via normalization)', async () => {
		// 佔有欲很強 (not 慾): protecting 占 breaks the 占有欲 phrase, so 欲
		// converts per-char — IDENTICAL to the tongwen path's output for this
		// input (probed). Parity with the house behaviour is the contract.
		expect(await convertWithConfig('占有欲很强', 's2t')).toBe('佔有欲很強');
		expect(await convertWithConfig('占有', 's2t')).toBe('佔有');
	});

	it('opts.protectedWords extends the default list on the OpenCC path', async () => {
		await warmConfig('s2t');
		expect(convertWithConfigSync('汉字', 's2t', { protectedWords: ['汉'] })).toBe('汉字');
		expect(convertWithConfigSync('汉字', 's2t')).toBe('漢字');
	});
});

describe('warmConfig / convertWithConfigSync — lazy + sync-handle discipline', () => {
	it('COLD: the sync handle answers null and isConfigWarm is false', async () => {
		vi.resetModules();
		const cold = await import('../src/opencc.js');
		expect(cold.isConfigWarm('s2hk')).toBe(false);
		expect(cold.convertWithConfigSync('头发', 's2hk')).toBeNull();
		vi.resetModules();
	});

	it('warmConfig resolves (never rejects) and publishes the sync handle', async () => {
		await expect(warmConfig('s2t')).resolves.toBeUndefined();
		expect(isConfigWarm('s2t')).toBe(true);
		expect(convertWithConfigSync('汉字', 's2t')).toBe('漢字');
		expect(convertWithConfigSync('头发', 's2t')).toBe('頭髮');
		expect(convertWithConfigSync('', 's2t')).toBeNull();
	});

	it('never throws — a broken opencc-js import degrades convertWithConfig to IDENTITY', async () => {
		vi.doMock('opencc-js', () => {
			throw new Error('chunk load failed');
		});
		vi.resetModules();
		const broken = await import('../src/opencc.js');
		expect(await broken.convertWithConfig('汉字', 's2t')).toBe('汉字');
		await expect(broken.warmConfig('s2t')).resolves.toBeUndefined();
		vi.doUnmock('opencc-js');
		vi.resetModules();
	});
});

describe('ConvertOptions.engine — opt-in OpenCC routing on the existing API', () => {
	it('s2tConvertLines with engine:"opencc" uses the config (default s2t)', async () => {
		expect(await s2tConvertLines(['鼠标'], { engine: 'opencc', config: 's2twp' })).toEqual(['滑鼠']);
		expect(await s2tConvertLines(['汉字'])).toEqual(['漢字']); // default engine untouched
	});

	it('t2sConvertLines with engine:"opencc" uses the config (default t2s)', async () => {
		expect(await t2sConvertLines(['軟體'], { engine: 'opencc', config: 'tw2sp' })).toEqual(['软件']);
	});

	it('lockScriptSync with engine:"opencc" converts once warm, identity while cold', async () => {
		vi.resetModules();
		const cold = await import('../src/convert.js');
		expect(cold.lockScriptSync('汉字', 'zh-Hant', { engine: 'opencc' })).toBe('汉字');
		vi.resetModules();
		await warmConfig('s2t');
		expect(lockScriptSync('汉字', 'zh-Hant', { engine: 'opencc' })).toBe('漢字');
		// …and the tongwen default lock is unaffected by the option existing.
		await warmScript('zh-Hant');
		expect(lockScriptSync('汉字', 'zh-Hant')).toBe('漢字');
	});
});

// @dawn-studio/zh-convert — Chinese script conversion for Dawn Studio apps.
export {
	s2tConvertLines,
	t2sConvertLines,
	s2tConvertLineSync,
	t2sConvertLineSync,
	isChineseLine,
	lockScriptSync,
	warmS2T,
	warmT2S,
	warmScript,
	PROTECTED_WORDS
} from './convert.js';
export type { ZhScript, ConvertOptions } from './convert.js';
export { detectLang, shouldTranslate } from './detect.js';
export type { LangTag } from './detect.js';
// OpenCC engine path (0.5.0+): config-based conversion modelled on OpenCC's
// preset configs (s2t, s2twp, hk2s, …). The tongwen path above stays the
// default; these are opt-in.
export {
	OPENCC_CONFIGS,
	openccConfig,
	convertWithConfig,
	convertWithConfigSync,
	warmConfig,
	isConfigWarm
} from './opencc.js';
export type { OpenCCConfig, OpenCCConfigName, OpenCCLocale } from './opencc.js';

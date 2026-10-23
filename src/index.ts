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
	warmScript
} from './convert.js';
export type { ZhScript } from './convert.js';
export { detectLang, shouldTranslate } from './detect.js';
export type { LangTag } from './detect.js';

// SPDX-License-Identifier: Apache-2.0
export { color, localized, type RenderContext } from './render/context.js';
export { plainText, renderRichText } from './render/richtext.js';
export { renderSlide, renderTextView, type RenderedSlide } from './render/slide.js';
export { Player, type NodeApi, type PlayerOptions } from './runtime/player.js';
export { stringsFor } from './runtime/strings.js';
export { noTracking, type CompletionResult, type ResumeState, type Tracker } from './tracking/types.js';
export { findScorm12Api, scorm12Tracker } from './tracking/scorm12.js';
export { findScorm2004Api, scorm2004Response, scorm2004Tracker } from './tracking/scorm2004.js';
export { xapiTracker, XapiClient } from './tracking/xapi.js';
export { cmi5Tracker } from './tracking/cmi5.js';
export type { InteractionRecord } from './tracking/types.js';

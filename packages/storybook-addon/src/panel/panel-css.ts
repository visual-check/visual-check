import type { StorybookTheme } from 'storybook/theming'

/**
 * Gives the colours of the statuses' text. Each stands out from the theme's backgrounds.
 */
function statusColoursOf({ base, color }: StorybookTheme): { positive: string; negative: string; warning: string } {
  return base === 'dark'
    ? { positive: color.positive, negative: color.negative, warning: color.warning }
    : { positive: color.positiveText, negative: color.negativeText, warning: color.warningText }
}

/**
 * Gives the panel's CSS. It reads only what the theme of every Storybook 10 has. The list's style is an empty string,
 * since Safari takes a list without a style for no list. The layers of the slider are opaque, so the snapshot's never
 * shows the baseline, hatched where the other image is larger, and plain below an image that is faded. Forced colours
 * leave out box shadows and gradients, so there a thicker border marks what is pressed.
 */
export function panelCssOf(theme: StorybookTheme): string {
  const { appBorderColor, appBorderRadius, background, barSelectedColor, color, textMutedColor, typography } = theme
  const { positive, negative, warning } = statusColoursOf(theme)

  return `
[data-visual-check="panel"] {
  padding: 12px 16px;
  color: ${color.defaultText};
  font-size: ${typography.size.s1 + 1}px;
  line-height: 1.5;
}
:where([data-visual-check="panel"]) * { box-sizing: border-box; }
:where([data-visual-check="panel"]) :is(p, pre, ul, figure, fieldset) { margin: 0; padding: 0; }
:where([data-visual-check="panel"]) :is(code, pre) {
  font-family: ${typography.fonts.mono};
  font-size: ${typography.size.s1}px;
}
:where([data-visual-check="panel"]) pre { white-space: pre-wrap; overflow-wrap: anywhere; }
:where([data-visual-check="panel"]) button {
  border: 1px solid ${appBorderColor};
  border-radius: ${appBorderRadius}px;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
:where([data-visual-check="panel"]) button:focus-visible { outline: 2px solid ${barSelectedColor}; outline-offset: 1px; }
[data-visual-check="panel"] button[aria-disabled="true"] {
  background: transparent;
  color: ${textMutedColor};
  cursor: default;
}
[data-visual-check="toolbar"] { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
:is(
  [data-visual-check="check"],
  [data-visual-check="update"],
  [data-visual-check="cancel"]
) {
  padding: 4px 12px;
  background: ${background.content};
  font-weight: ${typography.weight.bold};
}
:is(
  [data-visual-check="check"],
  [data-visual-check="update"],
  [data-visual-check="cancel"]
):hover:not([aria-disabled="true"]) {
  border-color: currentColor;
}
:is([data-visual-check="run"], [data-visual-check="empty"], [data-visual-check="disabled"]) { color: ${textMutedColor}; }
:is([data-visual-check="empty"], [data-visual-check="disabled"], [data-visual-check="init-hint"]) { margin-top: 12px; }
:is(
  [data-visual-check="log"],
  [data-visual-check="notice"],
  [data-visual-check="stale"],
  [data-visual-check="error"],
  [data-visual-check="warning"]
) {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid ${appBorderColor};
  border-radius: ${appBorderRadius}px;
  background: ${background.content};
}
[data-visual-check="stale"] { border-color: ${warning}; }
[data-visual-check="error"] { border-color: ${negative}; }
[data-visual-check="warning"] { border-color: ${warning}; }
:is([data-visual-check="notice"], [data-visual-check="error"], [data-visual-check="warning"]) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
[data-visual-check="snapshots"] { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; margin-top: 12px; }
[data-visual-check="rows"] { flex: 1 1 260px; min-width: 0; list-style-type: ''; }
[data-visual-check="rows"] > li { padding-bottom: 8px; }
:is([data-visual-check="row"], [data-visual-check="update-row"]) {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  text-align: start;
}
[data-visual-check="update-row"] { border: 1px solid transparent; }
[data-visual-check="row"]:is(:hover, [aria-pressed="true"]) { background: ${background.content}; }
[data-visual-check="row"][aria-pressed="true"] {
  border-color: ${barSelectedColor};
  box-shadow: inset 3px 0 ${barSelectedColor};
}
:is([data-visual-check="label"], [data-visual-check="status"]) { font-weight: ${typography.weight.bold}; }
[data-visual-check="label"] { flex: 1 1 auto; overflow-wrap: anywhere; }
[data-visual-check="flaky"] { color: ${warning}; }
[data-status="passed"] > [data-visual-check="status"] { color: ${positive}; }
[data-status="written"] > [data-visual-check="status"] { color: ${positive}; }
[data-status="missing"] > [data-visual-check="status"] { color: ${warning}; }
[data-status="kept"] > [data-visual-check="status"] { color: ${textMutedColor}; }
:is([data-status="differs"], [data-status="broken"]) > [data-visual-check="status"] { color: ${negative}; }
:is(
  [data-visual-check="path"],
  [data-visual-check="message"],
  [data-visual-check="reason"],
  [data-visual-check="details"],
  [data-visual-check="hint"]
) {
  margin: 4px 10px 0;
  overflow-wrap: anywhere;
}
[data-visual-check="path"] { display: block; }
[data-visual-check="details"] { color: ${textMutedColor}; }
[data-visual-check="viewer"] { flex: 0 1 auto; min-width: 0; max-width: 100%; }
[data-visual-check="views"] { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; border: 0; }
:is([data-visual-check="view-slider"], [data-visual-check="view-diff"]) { padding: 2px 10px; background: transparent; }
:is([data-visual-check="view-slider"], [data-visual-check="view-diff"]):is(:hover, [aria-pressed="true"]) {
  background: ${background.content};
}
:is([data-visual-check="view-slider"], [data-visual-check="view-diff"])[aria-pressed="true"] {
  border-color: ${barSelectedColor};
  box-shadow: inset 0 -3px ${barSelectedColor};
}
[data-visual-check="caption"] {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0 16px;
  margin-bottom: 4px;
  color: ${textMutedColor};
}
[data-visual-check="viewer"] img { display: block; max-width: 100%; height: auto; }
:is([data-visual-check="viewer"] img, [data-visual-check="stage"]) { outline: 1px solid ${appBorderColor}; }
[data-visual-check="stage"] { position: relative; max-width: 100%; }
[data-visual-check="stage"] > * { position: absolute; inset: 0; }
[data-visual-check^="layer-"] {
  background: repeating-linear-gradient(45deg, ${appBorderColor} 0 1px, transparent 1px 6px) ${background.app};
}
[data-visual-check="stage"] > [data-visual-check="divider"] {
  right: auto;
  border-left: 2px solid #fff;
  box-shadow: 0 0 0 1px #000;
  transform: translateX(-50%);
}
[data-visual-check="slider"] {
  width: 100%;
  height: 100%;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: ew-resize;
}
[data-visual-check="slider"]:focus-visible { outline: 2px solid ${barSelectedColor}; outline-offset: 1px; }
[data-visual-check="slider"]::-webkit-slider-runnable-track { height: 100%; background: transparent; }
[data-visual-check="slider"]::-webkit-slider-thumb { width: 1px; height: 100%; appearance: none; background: transparent; }
[data-visual-check="slider"]::-moz-range-track { height: 100%; background: transparent; }
[data-visual-check="slider"]::-moz-range-thumb { width: 1px; height: 100%; border: 0; background: transparent; }
[data-dimmed] { color: ${textMutedColor}; }
[data-dimmed] :is([data-visual-check="status"], [data-visual-check="flaky"]) { color: inherit; }
[data-dimmed] [data-visual-check^="image-"] { opacity: 0.55; }
[data-dimmed] [data-visual-check^="layer-"] { background: ${background.app}; }
@media (forced-colors: active) {
  :is([data-visual-check="row"], [data-visual-check="view-slider"], [data-visual-check="view-diff"])[aria-pressed="true"] {
    border: 3px solid Highlight;
  }
}
`
}

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
 * since Safari takes a list without a style for no list.
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
:where([data-visual-check="panel"]) :is(p, pre, ul) { margin: 0; padding: 0; }
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
:is([data-visual-check="check"], [data-visual-check="cancel"]) {
  padding: 4px 12px;
  background: ${background.content};
  font-weight: ${typography.weight.bold};
}
:is([data-visual-check="check"], [data-visual-check="cancel"]):hover:not([aria-disabled="true"]) {
  border-color: currentColor;
}
:is([data-visual-check="run"], [data-visual-check="empty"], [data-visual-check="disabled"]) { color: ${textMutedColor}; }
:is([data-visual-check="empty"], [data-visual-check="disabled"], [data-visual-check="init-hint"]) { margin-top: 12px; }
:is(
  [data-visual-check="log"],
  [data-visual-check="notice"],
  [data-visual-check="stale"],
  [data-visual-check="error"]
) {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid ${appBorderColor};
  border-radius: ${appBorderRadius}px;
  background: ${background.content};
}
[data-visual-check="stale"] { border-color: ${warning}; }
[data-visual-check="error"] { border-color: ${negative}; }
:is([data-visual-check="notice"], [data-visual-check="error"]) { white-space: pre-wrap; overflow-wrap: anywhere; }
[data-visual-check="snapshots"] { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; margin-top: 12px; }
[data-visual-check="rows"] { flex: 1 1 260px; min-width: 0; list-style-type: ''; }
[data-visual-check="rows"] > li { padding-bottom: 8px; }
[data-visual-check="row"] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  text-align: start;
}
[data-visual-check="row"]:is(:hover, [aria-pressed="true"]) { background: ${background.content}; }
[data-visual-check="row"][aria-pressed="true"] {
  border-color: ${barSelectedColor};
  box-shadow: inset 3px 0 ${barSelectedColor};
}
:is([data-visual-check="label"], [data-visual-check="status"]) { font-weight: ${typography.weight.bold}; }
[data-visual-check="label"] { flex: 1 1 auto; overflow-wrap: anywhere; }
[data-visual-check="flaky"] { color: ${warning}; }
[data-status="passed"] > [data-visual-check="status"] { color: ${positive}; }
[data-status="missing"] > [data-visual-check="status"] { color: ${warning}; }
:is([data-status="differs"], [data-status="broken"]) > [data-visual-check="status"] { color: ${negative}; }
:is(
  [data-visual-check="message"],
  [data-visual-check="reason"],
  [data-visual-check="details"],
  [data-visual-check="hint"]
) {
  margin: 4px 10px 0;
  overflow-wrap: anywhere;
}
[data-visual-check="details"] { color: ${textMutedColor}; }
[data-visual-check="image"] {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  height: auto;
  border: 1px solid ${appBorderColor};
}
[data-dimmed] { color: ${textMutedColor}; }
[data-dimmed] :is([data-visual-check="status"], [data-visual-check="flaky"]) { color: inherit; }
[data-dimmed] [data-visual-check="image"] { opacity: 0.55; }
`
}

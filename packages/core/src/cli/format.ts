/**
 * Shared unicode symbols for CLI output formatting.
 */

export const CHECK = '\u2714';
export const CROSS = '\u2718';
export const BULLET = '\u25c6';
export const WARN = '\u26a0';
export const DOT = '\u2022'; // bullet point for lists

export const DASH = '\u2500';
export const CORNER_TL = '\u250c';
export const CORNER_BL = '\u2514';
export const CORNER_TR = '\u2510';
export const CORNER_BR = '\u2518';
export const BAR = '\u2502';

/** Total box width including side borders */
const W = 47;

/** Top/bottom borders (W chars wide) */
export const TOP = `${CORNER_TL}${DASH.repeat(W - 2)}${CORNER_TR}`;
export const BOTTOM = `${CORNER_BL}${DASH.repeat(W - 2)}${CORNER_BR}`;

/**
 * Wrap a title string in a box.
 * Returns [top, title_line, bottom].
 * Total width = W.
 */
export function box(title: string): string[] {
  const inner = W - 2; // space between side bars
  const padding = inner - title.length;
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return [
    TOP,
    `${BAR}${' '.repeat(left)}${title}${' '.repeat(right)}${BAR}`,
    BOTTOM,
  ];
}

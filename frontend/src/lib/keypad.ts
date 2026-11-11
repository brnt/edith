// The channel grid is laid out like a numeric keypad, so a channel's number key is where its
// thumbnail is:   7 8 9
//                 4 5 6
//                 1 2 3
export const KEYPAD_COLS = 3;

/** How many keypad rows the numbers 1..maxNumber occupy (the empty rows above are left out). */
export function keypadRows(maxNumber: number): number {
  return Math.max(0, Math.ceil(maxNumber / KEYPAD_COLS));
}

/** The 1-based grid cell of channel number `n` when the keypad has `rows` rows: 1 is bottom left. */
export function keypadCell(n: number, rows: number): { row: number; col: number } {
  return { row: rows - Math.floor((n - 1) / KEYPAD_COLS), col: ((n - 1) % KEYPAD_COLS) + 1 };
}

/** The cell for the i-th channel without a number: after the keypad, three to a row. */
export function overflowCell(i: number, rows: number): { row: number; col: number } {
  return { row: rows + 1 + Math.floor(i / KEYPAD_COLS), col: (i % KEYPAD_COLS) + 1 };
}

/**
 * How wide each 16:9 tile can be: a third of the width, but small enough that all the rows fit in
 * the height (so the grid never scrolls and the keypad stays whole).
 */
export function tileWidth(width: number, height: number, rows: number, gap: number): number {
  if (rows <= 0) return 0;
  const byWidth = (width - gap * (KEYPAD_COLS - 1)) / KEYPAD_COLS;
  const byHeight = ((height - gap * (rows - 1)) / rows) * (16 / 9);
  return Math.max(0, Math.floor(Math.min(byWidth, byHeight)));
}

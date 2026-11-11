import { expect, test } from "vitest";

import { keypadCell, keypadRows, overflowCell, tileWidth } from "./keypad";

test("numbers sit where they do on a 10-key: 7 8 9 on top, 1 2 3 at the bottom", () => {
  const rows = keypadRows(9);
  const at = (n: number) => keypadCell(n, rows);
  expect([7, 8, 9].map(at)).toEqual([
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 1, col: 3 },
  ]);
  expect([4, 5, 6].map((n) => at(n).row)).toEqual([2, 2, 2]);
  expect([1, 2, 3].map(at)).toEqual([
    { row: 3, col: 1 },
    { row: 3, col: 2 },
    { row: 3, col: 3 },
  ]);
});

test("rows nobody uses are left out, and the bottom row stays 1 2 3", () => {
  expect(keypadRows(0)).toBe(0);
  expect(keypadRows(3)).toBe(1);
  expect(keypadRows(4)).toBe(2);
  // Four channels: 4 sits above 1, and there are only two rows.
  expect(keypadCell(1, 2)).toEqual({ row: 2, col: 1 });
  expect(keypadCell(4, 2)).toEqual({ row: 1, col: 1 });
});

test("channels beyond the keypad (no number) go in rows below it", () => {
  expect(overflowCell(0, 3)).toEqual({ row: 4, col: 1 });
  expect(overflowCell(4, 3)).toEqual({ row: 5, col: 2 });
});

test("tiles are a third of the width, shrunk so every row fits the height", () => {
  expect(tileWidth(480, 1000, 3, 8)).toBe(154); // width is the limit: (480 - 16) / 3
  // Height is the limit: three rows of 16:9 tiles in 300px (8px gaps) -> (300 - 16) / 3 * 16/9.
  expect(tileWidth(900, 300, 3, 8)).toBe(168);
  expect(tileWidth(900, 300, 0, 8)).toBe(0);
});

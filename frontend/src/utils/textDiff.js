/**
 * Minimal line-based diff (Myers) for UI display.
 *
 * Notes:
 * - This is intended for visual comparison only (not a perfect patch generator).
 * - Guarded by maxTotalLines to avoid freezing the UI on very large outputs.
 */

function normalizeText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * @typedef {'equal'|'add'|'del'} DiffOpType
 * @typedef {{ type: DiffOpType, line: string }} DiffOp
 */

/**
 * Compute a diff between two texts, split by lines.
 * @param {string} oldText
 * @param {string} newText
 * @param {{ maxTotalLines?: number }} [options]
 * @returns {{
 *   tooLarge: boolean,
 *   ops: DiffOp[],
 *   oldLineCount: number,
 *   newLineCount: number,
 *   maxTotalLines: number,
 * }}
 */
export function diffLines(oldText, newText, { maxTotalLines = 800 } = {}) {
  const a = normalizeText(oldText).split('\n');
  const b = normalizeText(newText).split('\n');

  const totalLines = a.length + b.length;
  if (totalLines > maxTotalLines) {
    return {
      tooLarge: true,
      ops: [],
      oldLineCount: a.length,
      newLineCount: b.length,
      maxTotalLines,
    };
  }

  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;

  let v = new Int32Array(2 * max + 1);
  v.fill(-1);
  v[offset + 1] = 0;

  /** @type {Int32Array[]} */
  const trace = [];

  let found = false;
  for (let d = 0; d <= max; d += 1) {
    const vNew = new Int32Array(2 * max + 1);
    vNew.fill(-1);

    for (let k = -d; k <= d; k += 2) {
      const index = k + offset;

      let x;
      if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
        // Insertion
        x = v[index + 1];
      } else {
        // Deletion
        x = v[index - 1] + 1;
      }

      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      vNew[index] = x;

      if (x >= n && y >= m) {
        trace.push(vNew);
        found = true;
        break;
      }
    }

    if (found) break;
    trace.push(vNew);
    v = vNew;
  }

  // Backtrack to build ops
  let x = n;
  let y = m;
  /** @type {DiffOp[]} */
  const opsRev = [];

  for (let d = trace.length - 1; d > 0; d -= 1) {
    const prevV = trace[d - 1];
    const k = x - y;
    const index = k + offset;

    let prevK;
    if (k === -d || (k !== d && prevV[index - 1] < prevV[index + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = prevV[prevK + offset];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      opsRev.push({ type: 'equal', line: a[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (x === prevX) {
      opsRev.push({ type: 'add', line: b[y - 1] });
      y -= 1;
    } else {
      opsRev.push({ type: 'del', line: a[x - 1] });
      x -= 1;
    }
  }

  // Any remaining head (identical or pure inserts/deletes)
  while (x > 0 && y > 0) {
    opsRev.push({ type: 'equal', line: a[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    opsRev.push({ type: 'del', line: a[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    opsRev.push({ type: 'add', line: b[y - 1] });
    y -= 1;
  }

  opsRev.reverse();

  return {
    tooLarge: false,
    ops: opsRev,
    oldLineCount: a.length,
    newLineCount: b.length,
    maxTotalLines,
  };
}


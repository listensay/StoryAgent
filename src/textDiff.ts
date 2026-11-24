export type DiffLine = { text: string; changed: boolean };

// Bound the comparison matrix for long outlines; shared ends still remain unchanged.
export function textDiff(left: string, right: string): [DiffLine[], DiffLine[]] {
  const a = left ? left.replace(/\r\n/g, '\n').split('\n') : [];
  const b = right ? right.replace(/\r\n/g, '\n').split('\n') : [];
  const unchanged = (text: string): DiffLine => ({ text, changed: false });
  const changed = (text: string): DiffLine => ({ text, changed: true });
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  const before = a.slice(0, start).map(unchanged), after = b.slice(0, start).map(unchanged);
  if ((x.length + 1) * (y.length + 1) <= 1_000_000) {
    const width = y.length + 1, matrix = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
      matrix[i * width + j] = x[i] === y[j] ? matrix[(i + 1) * width + j + 1] + 1 : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { before.push(unchanged(x[i++])); after.push(unchanged(y[j++])); }
      else if (i < x.length && (j === y.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) before.push(changed(x[i++]));
      else after.push(changed(y[j++]));
    }
  } else { before.push(...x.map(changed)); after.push(...y.map(changed)); }
  before.push(...a.slice(a.length - end).map(unchanged));
  after.push(...b.slice(b.length - end).map(unchanged));
  return [before, after];
}

// Simple fractional indexing for sibling ordering.
// Keys are lowercase strings sorted lexicographically.
// `between(a, b)` returns a string strictly between a and b (or strictly after a
// when b is null, strictly before b when a is null).

const MIN = "a".charCodeAt(0);
const MAX = "z".charCodeAt(0) + 1; // exclusive
const MID = Math.floor((MIN + MAX) / 2);

function code(s: string, i: number): number {
  return i < s.length ? s.charCodeAt(i) : MIN - 1;
}

export function between(a: string | null, b: string | null): string {
  // Both null → start from middle.
  if (!a && !b) return String.fromCharCode(MID);

  // Append before b
  if (!a && b) {
    const first = b.charCodeAt(0);
    if (first > MIN) return String.fromCharCode(Math.floor((MIN + first) / 2));
    // first is 'a' — recurse: prefix 'a' then insert before b[1..]
    return "a" + between(null, b.slice(1) || null);
  }

  // Append after a
  if (a && !b) {
    const last = a.charCodeAt(a.length - 1);
    if (last < MAX - 1) {
      return a.slice(0, -1) + String.fromCharCode(Math.floor((last + MAX) / 2));
    }
    return a + String.fromCharCode(MID);
  }

  // Both set: walk characters until we can fit a midpoint.
  let prefix = "";
  let i = 0;
  while (true) {
    const ca = code(a!, i);
    const cb = code(b!, i);
    if (ca === cb) {
      prefix += String.fromCharCode(ca);
      i++;
      continue;
    }
    if (cb - ca > 1) {
      return prefix + String.fromCharCode(Math.floor((ca + cb) / 2));
    }
    // Adjacent: keep ca, then find a key strictly after a[i+1..]
    prefix += String.fromCharCode(ca);
    return prefix + between(a!.slice(i + 1) || null, null);
  }
}

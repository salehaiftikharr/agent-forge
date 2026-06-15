// A tiny utility library — the codebase the minions practice on.
// Some functions are intentionally buggy or incomplete; each gap maps to a
// seeded ticket in ../tickets.json. The test suite (../test/utils.test.js) is
// the acceptance gate a minion's fix has to clear.

export function add(a, b) {
  return a + b;
}

export function slugify(input) {
  // BUG (TICKET-001): a run of consecutive spaces becomes multiple dashes
  // instead of one.
  return String(input).trim().toLowerCase().replace(/ /g, "-");
}

export function parseQueryString(qs) {
  const out = {};
  for (const pair of String(qs).replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const [key, value] = pair.split("=");
    // BUG (TICKET-003): values aren't URL-decoded, and a key with no "="
    // gets `undefined` instead of an empty string.
    out[key] = value;
  }
  return out;
}

// TICKET-002: a `clamp(n, min, max)` helper is requested but doesn't exist yet.

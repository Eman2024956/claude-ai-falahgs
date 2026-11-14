// Arabic front end: brief -> the same concepts and arguments the rules take.
//
//   1. normalise   strip diacritics, unify alef/hamza, ya and ta marbuta
//   2. tokenise    split into words, keeping where each came from
//   3. look up     match words and phrases against lexicon.ar.json
//   4. attach      give each modifier (colour, shade, speed...) to the nearest thing
//   5. audit       report unknown words (with a spelling suggestion), negations,
//                  conflicts and modifiers with nothing to attach to
//
// Nothing here guesses: a word that is not in the dictionary is reported.

import { readFileSync } from 'node:fs';

const lexicon = JSON.parse(readFileSync(new URL('./lexicon.ar.json', import.meta.url), 'utf8'));

export function normalise(text) {
  return text
    .replace(/[ً-ٰٟـ]/g, '') // diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

// A word with its attached particles peeled off: "وبالسيارة" also matches "سيارة".
function forms(word) {
  const out = new Set([word]);
  for (let pass = 0; pass < 3; pass++) {
    for (const f of [...out]) {
      if (/^[وف]/.test(f) && f.length > 3) out.add(f.slice(1));
      if (/^[بلك]/.test(f) && f.length > 3) out.add(f.slice(1));
      if (f.startsWith('ال') && f.length > 4) out.add(f.slice(2));
      if (f.startsWith('لل') && f.length > 4) out.add(f.slice(2));
      if (f.endsWith('ا') && f.length > 3) out.add(f.slice(0, -1)); // tanween: فاخراً
    }
  }
  return out;
}

function tokenise(brief) {
  const tokens = [];
  const word = /[ء-يً-ٰٟـ]+/g;
  let m;
  while ((m = word.exec(brief))) {
    tokens.push({ raw: m[0], forms: forms(normalise(m[0])), start: m.index, end: m.index + m[0].length, used: false });
  }
  // Clause number, so a negation or modifier does not reach across a full stop.
  let clause = 0;
  let last = 0;
  for (const t of tokens) {
    if (/[.،,;؛!?؟\n]/.test(brief.slice(last, t.start))) clause++;
    t.clause = clause;
    last = t.end;
  }
  return tokens;
}

// term list -> [{ concept, words[] }], longest phrases first.
function entries(group) {
  const list = [];
  for (const [concept, terms] of Object.entries(group)) {
    for (const term of terms) list.push({ concept, words: normalise(term).split(/\s+/) });
  }
  return list.sort((a, b) => b.words.length - a.words.length);
}

const THINGS = entries(lexicon.things);
const MODIFIERS = entries(lexicon.modifiers);
const NEGATIONS = entries({ negation: lexicon.negation });
const AROUND = new Set(lexicon.around.map(normalise));
const IGNORE = new Set(lexicon.ignore.map(normalise));
// Single dictionary words, normalised -> as written, for spelling suggestions.
const KNOWN_WORDS = new Map();
for (const group of [lexicon.things, lexicon.modifiers]) {
  for (const term of Object.values(group).flat()) {
    for (const word of term.split(/\s+/)) KNOWN_WORDS.set(normalise(word), word);
  }
}

function matchAt(tokens, i, list) {
  for (const entry of list) {
    const n = entry.words.length;
    if (i + n > tokens.length) continue;
    if (entry.words.every((w, k) => !tokens[i + k].used && tokens[i + k].forms.has(w))) {
      return { concept: entry.concept, from: i, to: i + n - 1 };
    }
  }
  return null;
}

function scan(tokens, list) {
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    const hit = matchAt(tokens, i, list);
    if (!hit) continue;
    for (let k = hit.from; k <= hit.to; k++) tokens[k].used = true;
    hits.push(hit);
    i = hit.to;
  }
  return hits;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

function suggestion(token) {
  for (const form of token.forms) {
    if (form.length < 3) continue;
    for (const [word, written] of KNOWN_WORDS) {
      if (word.length >= 4 && editDistance(form, word) === 1) return written;
    }
  }
  return null;
}

export function readArabic(brief) {
  const tokens = tokenise(brief);
  const raw = (hit) => brief.slice(tokens[hit.from].start, tokens[hit.to].end);
  const unresolved = [];

  const negations = scan(tokens, NEGATIONS);
  const things = scan(tokens, THINGS);
  const modifiers = scan(tokens, MODIFIERS);

  // "تتحرك ... حول" means orbiting; "تتحرك" on its own does not.
  for (const hit of things) {
    if (hit.concept !== 'camera-move') continue;
    const circling = tokens.slice(hit.to + 1, hit.to + 4).some((t) => t.clause === tokens[hit.to].clause && [...t.forms].some((f) => AROUND.has(f)));
    if (circling) hit.concept = 'camera';
    else unresolved.push(`«${raw(hit)}»: حركة الكاميرا غير محددة. المدعوم هو الدوران حول المجسّم.`);
  }

  // A thing right after "بدون / بلا / من غير" is asked NOT to be there.
  for (const hit of things) {
    hit.negated = negations.some((n) => n.to === hit.from - 1 && tokens[n.to].clause === tokens[hit.from].clause);
  }

  // One entry per concept: the first mention wins.
  const found = [];
  const byIntent = {};
  for (const hit of things) {
    if (hit.concept === 'camera-move' || byIntent[hit.concept]) continue;
    const entry = { intent: hit.concept, phrase: (hit.negated ? `${raw(negations.find((n) => n.to === hit.from - 1))} ` : '') + raw(hit), args: {}, negated: hit.negated, at: hit.from };
    byIntent[hit.concept] = entry;
    found.push(entry);
  }

  // Attach each modifier to the nearest thing it can describe, in the same clause.
  // On a tie the thing before it wins: Arabic adjectives follow their noun.
  const nearest = (mod, candidates) => {
    let best = null;
    for (const name of candidates) {
      const hit = things.find((t) => t.concept === name && !t.negated && tokens[t.from].clause === tokens[mod.from].clause);
      if (!hit) continue;
      const distance = hit.to < mod.from ? mod.from - hit.to - 0.5 : hit.from - mod.to;
      if (!best || distance < best.distance) best = { name, distance };
    }
    return best && best.name;
  };
  const orphan = (mod, what) => unresolved.push(`«${raw(mod)}»: لم أجد ${what} يصفه في الجملة نفسها.`);

  for (const mod of modifiers) {
    const [kind, value] = mod.concept.split('.');
    if (kind === 'color') {
      const owner = nearest(mod, ['subject', 'floor']);
      if (owner === 'subject') {
        const paint = (byIntent.paint ??= { intent: 'paint', phrase: raw(mod), args: { color: value }, at: mod.from });
        if (!found.includes(paint)) found.push(paint);
        else if (paint.args.color !== value) unresolved.push(`تعارض: لونان للسيارة «${paint.phrase}» و«${raw(mod)}». استُخدم الأول.`);
      } else if (owner === 'floor') {
        if (value === 'white') byIntent.floor.args.light = true;
        else if (value !== 'black') unresolved.push(`«${raw(mod)}»: الرخام متوفر بالأسود أو الأبيض فقط.`);
        byIntent.floor.phrase += ` ${raw(mod)}`;
      } else orphan(mod, 'سيارة أو رخاماً');
    }
    if (kind === 'shade') {
      const owner = nearest(mod, ['environment', 'floor']);
      if (owner === 'environment') byIntent.environment.args.dark = value === 'dark';
      else if (owner === 'floor') byIntent.floor.args.light = value === 'light';
      else orphan(mod, 'صالة أو رخاماً');
      if (owner) byIntent[owner].phrase += ` ${raw(mod)}`;
    }
    if (kind === 'soft') {
      if (nearest(mod, ['lighting'])) {
        byIntent.lighting.args.soft = true;
        byIntent.lighting.phrase += ` ${raw(mod)}`;
      } else orphan(mod, 'إضاءة حجمية');
    }
    if (kind === 'speed') {
      if (nearest(mod, ['camera'])) {
        byIntent.camera.args.speed = value;
        byIntent.camera.phrase += ` ${raw(mod)}`;
      } else orphan(mod, 'دوران كاميرا');
    }
  }

  // Everything left over is reported, with the closest dictionary word if there is one.
  for (const t of tokens) {
    if (t.used || [...t.forms].some((f) => IGNORE.has(f)) || t.raw.length < 3) continue;
    const near = suggestion(t);
    unresolved.push(near ? `كلمة غير معروفة: «${t.raw}» (هل تقصد «${near}»؟)` : `كلمة غير معروفة: «${t.raw}»`);
  }

  return { found, unresolved };
}

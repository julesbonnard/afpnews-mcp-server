import { z } from 'zod';
import type { AfpDocument, ApiCore } from 'afpnews-api';
import { textContent, toolError } from '../utils/format.js';
import { PARAGRAPH_MARKER_NOTE } from './shared.js';

const MAX_DOCS = 100;
// Borne la réponse renvoyée au LLM ; les meilleurs passages passent en premier.
const MAX_OUTPUT_CHARS = 24_000;

const inputSchema = z.object({
  unos: z.string().array().min(1).max(MAX_DOCS).describe('UNOs returned by a previous search'),
  terms: z
    .string()
    .min(2)
    .array()
    .max(10)
    .optional()
    .describe(
      'Names, keywords or short phrases to look for, with useful variants (other spellings, translations). Case and accents ignored, plurals and inflections caught.',
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      'JavaScript regular expression (no slashes, case-insensitive) for what terms cannot express: alternatives, a phrase with variable words, numbers. Tested on the text with and without accents. Matches inside words.',
    ),
  quotesOnly: z
    .boolean()
    .optional()
    .describe('Keep only paragraphs containing quotation marks, and only video shots with a soundbite'),
  lead: z
    .boolean()
    .optional()
    .describe(
      "Add each matching document's lead ([¶1]): AFP wires put the essentials first (who, what, where, when), so it gives the context of a passage. Alone, without terms, pattern or quotesOnly: returns only the lead of every document (caption for videos), a cheap way to triage before reading anything in full. Feature genres (reportage, papier d'angle) may open with a narrative hook instead.",
    ),
  context: z.number().int().min(0).max(2).optional().describe('Paragraphs kept before and after each match (default 0)'),
});

type FindPassagesInput = z.infer<typeof inputSchema>;

type Matcher = (text: string, normalized: string) => number;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Début de mot imposé, fin libre : pluriels et flexions passent, « RN » ne matche pas « gouvernement ».
function termMatcher(term: string): Matcher {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalize(term.trim()))}`, 'u');
  return (_, normalized) => (re.test(normalized) ? 1 : 0);
}

// Correspondances distinctes : sinon une alternative omniprésente (euro → européen) égalise tout et l'ordre du texte décide.
function patternMatcher(pattern: string): Matcher {
  const re = new RegExp(pattern, 'giu');
  return (text, normalized) => {
    const distinct = new Set<string>();
    for (const source of [text, normalized])
      for (const [m] of source.matchAll(re)) if (m) distinct.add(normalize(m));
    return distinct.size;
  };
}

const QUOTE_MARKS = /["«»“”„]/;

// Sans terme ni motif, quotesOnly garde toutes les citations (score 1).
function score(text: string, matchers: Matcher[], quoted: boolean): number {
  if (!quoted) return 0;
  if (!matchers.length) return 1;
  const normalized = normalize(text);
  return matchers.reduce((sum, m) => sum + m(text, normalized), 0);
}

const isVideo = (doc: AfpDocument) => !!doc.shots?.length;

function header(doc: AfpDocument): string {
  const date = doc.published.toISOString().slice(0, 10);
  const genre = doc.genre ? ` · ${doc.genre}` : '';
  return `## ${doc.headline ?? doc.uno}\nUNO: ${doc.uno} · ${date} · ${doc.class}${genre}`;
}

function scores(doc: AfpDocument, matchers: Matcher[], quotesOnly: boolean): number[] {
  if (isVideo(doc))
    return doc.shots!.map(s =>
      score([s.description, ...s.citations.map(c => c.text)].join(' '), matchers, !quotesOnly || s.citations.length > 0),
    );
  return doc.paragraphs.map(p => score(p.text, matchers, !quotesOnly || QUOTE_MARKS.test(p.text)));
}

const hasLead = (doc: AfpDocument) => (isVideo(doc) ? !!doc.caption : doc.paragraphs.length > 0);

function render(doc: AfpDocument, kept: Set<number>, lead: boolean): string {
  if (isVideo(doc)) {
    const caption = lead && doc.caption ? `Caption: ${doc.caption}` : '';
    const shots = doc
      .shots!.filter((_, i) => kept.has(i))
      .map(s =>
        [
          `${s.numero}. [${s.start}-${s.end}] (t=${s.startSec}&end=${s.endSec}) ${s.description}`.trimEnd(),
          ...s.citations.map(c => `   "${c.text}"`),
        ].join('\n'),
      );
    return [header(doc), caption, ...shots].filter(Boolean).join('\n');
  }
  if (lead) kept = new Set([0, ...kept]);
  // Même numérotation [¶n] que afp_get_article (index + 1), pour les liens ?p=n.
  const lines = [header(doc)];
  let previous = -1;
  for (const i of [...kept].sort((a, b) => a - b)) {
    if (i > previous + 1 && previous >= 0) lines.push('[…]');
    lines.push(`[¶${i + 1}] ${doc.paragraphs[i].text}`);
    previous = i;
  }
  return lines.join('\n');
}

type Hit = { doc: number; index: number; score: number; rank: number };

// À score égal, le n-ième passage de chaque document passe avant le (n+1)-ième d'un autre : aucun ne monopolise le budget.
export function findPassages(
  docs: AfpDocument[],
  matchers: Matcher[],
  { context = 0, quotesOnly = false, lead = false } = {},
): { passages: string[]; unmatched: number[]; truncated: number[] } {
  const skim = lead && !matchers.length && !quotesOnly;
  const hits: Hit[] = docs.flatMap((doc, d) => {
    if (skim) return hasLead(doc) ? [{ doc: d, index: -1, score: 1, rank: 0 }] : [];
    return scores(doc, matchers, quotesOnly)
      .map((score, index) => ({ doc: d, index, score, rank: 0 }))
      .filter(h => h.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((h, rank) => ({ ...h, rank }));
  });
  hits.sort((a, b) => b.score - a.score || a.rank - b.rank || a.doc - b.doc);

  const kept = new Map<number, Set<number>>();
  const sizes = new Map<number, number>();
  let total = 0;
  let shown = 0;
  for (const hit of hits) {
    const doc = docs[hit.doc];
    const window = new Set(kept.get(hit.doc));
    const radius = isVideo(doc) ? 0 : context;
    const last = isVideo(doc) ? hit.index : doc.paragraphs.length - 1;
    if (hit.index >= 0)
      for (let j = Math.max(0, hit.index - radius); j <= Math.min(last, hit.index + radius); j++) window.add(j);
    const size = render(doc, window, lead).length;
    const growth = size - (sizes.get(hit.doc) ?? 0);
    if (shown && total + growth > MAX_OUTPUT_CHARS) break;
    kept.set(hit.doc, window);
    sizes.set(hit.doc, size);
    total += growth;
    shown++;
  }

  const matched = new Set(hits.map(h => h.doc));
  return {
    passages: docs.flatMap((doc, d) => (kept.has(d) ? [render(doc, kept.get(d)!, lead)] : [])),
    unmatched: docs.flatMap((_, d) => (matched.has(d) ? [] : [d])),
    truncated: [...new Set(hits.slice(shown).map(h => h.doc))].sort((a, b) => a - b),
  };
}

export const afpFindPassagesTool = {
  name: 'afp_find_passages',
  title: 'Find Passages in AFP Documents',
  description: `Find the passages that match given terms or a regular expression across up to ${MAX_DOCS} AFP documents at once (texts and videos together), without reading them in full: the best matching paragraphs for texts, matching shots and their soundbites for videos. Use it after a search to locate quotes, figures or facts, then call afp_get_article only on the documents whose full context is needed. Give distinctive terms: a word present in every document (e.g. the name of the person all results are about) matches every paragraph. No rephrasing is caught: give variants.

${PARAGRAPH_MARKER_NOTE}

Video shots carry their bounds in seconds as (t=start&end=end).`,
  inputSchema,
  handler: async (
    apicore: Pick<ApiCore, 'get'>,
    { unos, terms = [], pattern, context, quotesOnly, lead }: FindPassagesInput,
  ) => {
    if (!terms.length && !pattern && !quotesOnly && !lead) return toolError('Give terms, a pattern, quotesOnly or lead.');
    let matchers: Matcher[];
    try {
      matchers = [...terms.map(termMatcher), ...(pattern ? [patternMatcher(pattern)] : [])];
    } catch (e) {
      return toolError(`Invalid pattern: ${e instanceof Error ? e.message : String(e)}`);
    }
    const loaded = await Promise.all(unos.map(uno => apicore.get(uno, { parse: true }).catch(() => undefined)));
    const missing = unos.filter((_, i) => !loaded[i]);
    const docs = loaded.filter((doc): doc is AfpDocument => !!doc);
    const { passages, unmatched, truncated } = findPassages(docs, matchers, { context, quotesOnly, lead });
    const ids = (indexes: number[]) => indexes.map(d => docs[d].uno).join(', ');
    const text = [
      ...passages,
      unmatched.length && `No match in: ${ids(unmatched)}`,
      missing.length && `Not found: ${missing.join(', ')}`,
      truncated.length &&
        `Output limit reached, more matches in: ${ids(truncated)} (call again on these, or with narrower terms)`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return { content: [textContent(text)] };
  },
};

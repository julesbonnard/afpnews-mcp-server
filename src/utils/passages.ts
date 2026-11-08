import { z } from 'zod';
import type { AfpDocument } from 'afpnews-api';
import { CHARACTER_LIMIT } from './config.js';

function isValidRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern, 'giu');
    return true;
  } catch {
    return false;
  }
}

export const passagesSchema = z
  .object({
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
      .refine(isValidRegExp, 'Invalid regular expression')
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
        "Add each matching document's lead ([¶1]), which gives the context of a passage. Alone: returns only the lead of every document (caption for videos), to triage before reading in full. Feature genres may open with a narrative hook instead.",
      ),
    context: z.number().int().min(0).max(2).optional().describe('Paragraphs kept before and after each match (default 0)'),
  })
  .refine(p => p.terms?.length || p.pattern || p.quotesOnly || p.lead, 'Give terms, a pattern, quotesOnly or lead.');

export type PassagesOptions = z.infer<typeof passagesSchema>;

export const PASSAGES_NOTE =
  'Instead of excerpts, return only the passages matching terms or a pattern (paragraphs for texts, shots and soundbites for videos), ranked across all results; use it to locate quotes, figures or facts without reading everything. No rephrasing is caught: give variants.';

// Critères satisfaits par un texte : un par terme, un par correspondance distincte du motif.
type Matcher = (text: string, normalized: string) => string[];

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Début de mot imposé, fin libre : pluriels et flexions passent, « RN » ne matche pas « gouvernement ».
function termMatcher(term: string): Matcher {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalize(term.trim()))}`, 'u');
  return (_, normalized) => (re.test(normalized) ? [`term:${term}`] : []);
}

function patternMatcher(pattern: string): Matcher {
  const re = new RegExp(pattern, 'giu');
  return (text, normalized) => {
    const distinct = new Set<string>();
    for (const source of [text, normalized])
      for (const [m] of source.matchAll(re)) if (m) distinct.add(`pattern:${normalize(m)}`);
    return [...distinct];
  };
}

const QUOTE_MARKS = /["«»“”„]/;

// null : écarté par quotesOnly.
function criteria(text: string, matchers: Matcher[], quoted: boolean): string[] | null {
  if (!quoted) return null;
  const normalized = normalize(text);
  return matchers.flatMap(m => m(text, normalized));
}

const isVideo = (doc: AfpDocument) => !!doc.shots?.length;

function header(doc: AfpDocument): string {
  const date = doc.published.toISOString().slice(0, 10);
  const genre = doc.genre ? ` · ${doc.genre}` : '';
  return `## ${doc.headline ?? doc.uno}\nUNO: ${doc.uno} · ${date} · ${doc.class}${genre}`;
}

function units(doc: AfpDocument, matchers: Matcher[], quotesOnly: boolean): (string[] | null)[] {
  if (isVideo(doc))
    return doc.shots!.map(s =>
      criteria([s.description, ...s.citations.map(c => c.text)].join(' '), matchers, !quotesOnly || s.citations.length > 0),
    );
  return doc.paragraphs.map(p => criteria(p.text, matchers, !quotesOnly || QUOTE_MARKS.test(p.text)));
}

// Pondération IDF (comme BM25) sur l'ensemble des résultats : un critère présent partout (euro → européen,
// le nom de la personne cherchée) pèse peu, un critère rare beaucoup. Toujours > 0 : rien n'est écarté.
function scoreUnits(found: (string[] | null)[][], weighted: boolean): number[][] {
  if (!weighted) return found.map(doc => doc.map(keys => (keys ? 1 : 0)));
  const frequency = new Map<string, number>();
  let total = 0;
  for (const doc of found)
    for (const keys of doc) {
      total++;
      for (const key of keys ?? []) frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  const weight = (key: string) => Math.log(1 + total / frequency.get(key)!);
  return found.map(doc => doc.map(keys => (keys ?? []).reduce((sum, key) => sum + weight(key), 0)));
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
  // Même numérotation [¶n] que afp_get_article (index + 1), pour pointer un paragraphe.
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
function rankPassages(
  docs: AfpDocument[],
  matchers: Matcher[],
  { context = 0, quotesOnly = false, lead = false }: PassagesOptions,
): { passages: string[]; unmatched: number; truncated: string[] } {
  const skim = lead && !matchers.length && !quotesOnly;
  const scores = scoreUnits(
    docs.map(doc => (skim ? [] : units(doc, matchers, quotesOnly))),
    matchers.length > 0,
  );
  const hits: Hit[] = docs.flatMap((doc, d) => {
    if (skim) return hasLead(doc) ? [{ doc: d, index: -1, score: 1, rank: 0 }] : [];
    return scores[d]
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
    if (shown && total + growth > CHARACTER_LIMIT) break;
    kept.set(hit.doc, window);
    sizes.set(hit.doc, size);
    total += growth;
    shown++;
  }

  return {
    passages: docs.flatMap((doc, d) => (kept.has(d) ? [render(doc, kept.get(d)!, lead)] : [])),
    unmatched: docs.length - new Set(hits.map(h => h.doc)).size,
    truncated: [...new Set(hits.slice(shown).map(h => h.doc))].sort((a, b) => a - b).map(d => docs[d].uno),
  };
}

export function formatPassages(docs: AfpDocument[], options: PassagesOptions): string {
  const matchers = [
    ...(options.terms ?? []).map(termMatcher),
    ...(options.pattern ? [patternMatcher(options.pattern)] : []),
  ];
  const { passages, unmatched, truncated } = rankPassages(docs, matchers, options);
  return [
    ...passages,
    unmatched && `${unmatched} document(s) without match.`,
    truncated.length &&
      `Output limit reached, more matches in: ${truncated.join(', ')} (search again with facets.uno, or narrower terms)`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

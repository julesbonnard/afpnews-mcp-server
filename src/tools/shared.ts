import { z } from 'zod';
import { AFP_REGIONS, AGENDA_GENRE_EXCLUSIONS } from 'afpnews-api';
import { ALL_DOC_FIELDS } from '../utils/types.js';

export { AGENDA_GENRE_EXCLUSIONS };

// UNO format: newsml.afp.com.20260222T090659Z.doc-98hu39e
//   - timestamp: 20260222T090659Z → 2026-02-22 09:06:59 UTC
//   - afpshortid: the segment after "doc-" (e.g. 98hu39e)
// Published date and afpshortid are encoded in the UNO — no need to fetch them as separate fields.
export const UNO_FORMAT_NOTE = 'A UNO (newsml.afp.com.<timestamp>.doc-<afpshortid>) embeds the publication timestamp (UTC) and the short ID: request published or afpshortid only if needed.';

// Markdown output prefixes each paragraph with a `[¶n]` marker (1-based) — purely technical,
// never reproduce it when quoting or answering.
export const PARAGRAPH_MARKER_NOTE = 'Paragraphs are prefixed with a technical `[¶n]` marker (1-based): never reproduce it.';

export const UNO_FACET_NOTE = 'uno: a list of UNOs to work on given documents (default filters then dropped).';

// UNO demandés via facets.uno : la recherche est alors dimensionnée sur eux, sans filtre par défaut.
export function requestedUnos(facets: Record<string, unknown> | undefined): string[] | undefined {
  const uno = facets?.uno;
  if (typeof uno === 'string') return [uno];
  if (Array.isArray(uno)) return uno.map(String);
  return undefined;
}

export const REGION_FACET_NOTE = `region filters on the countries of an AFP region (${Object.keys(AFP_REGIONS).join(', ')}); any facet accepts { exclude: [...] }.`;

// La production en arabe de l'AFP porte le fournisseur « أ ف ب »
export const AFP_PROVIDERS = ['afp', 'أ ف ب'];

export const outputFormatEnum = z.enum(['markdown', 'json', 'csv']);
export type OutputFormat = z.infer<typeof outputFormatEnum>;

export const docFieldEnum = z.enum(ALL_DOC_FIELDS);

const SEARCH_PRESET_VALUES = ['a-la-une', 'agenda', 'previsions', 'major-stories', 'factcheck'] as const;
export const searchPresetEnum = z.enum(SEARCH_PRESET_VALUES);
type SearchPreset = z.infer<typeof searchPresetEnum>;

const LIST_PRESET_VALUES = ['trending-topics'] as const;
export const listPresetEnum = z.enum(LIST_PRESET_VALUES);

export const langEnum = z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']);

const MEDIA_CLASS_VALUES = ['picture', 'video', 'graphic', 'videography'] as const;
export const mediaClassEnum = z.enum(MEDIA_CLASS_VALUES);
export type MediaClass = z.infer<typeof mediaClassEnum>;

const RENDITION_VALUES = ['squared120', 'quicklook', 'thumbnail', 'mockup', 'preview', 'highdef'] as const;
export const renditionEnum = z.enum(RENDITION_VALUES);
export type RenditionKey = z.infer<typeof renditionEnum>;

export const facetParamValueSchema = z.union([
  z.string(),
  z.number(),
  z.string().array(),
  z.number().array(),
  z.object({
    in: z.union([z.string().array(), z.number().array()]).optional(),
    exclude: z.union([z.string().array(), z.number().array()]).optional(),
  }).refine((v) => v.in !== undefined || v.exclude !== undefined, {
    message: "Facet filter object must include either 'in' or 'exclude'.",
  }),
]);

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

interface PresetOverrides {
  class?: string[];
  langs?: string[];
  slug?: string[];
  dateFrom?: string;
  size?: number;
  genreid?: Record<string, string[]> | string[];
}

export const SEARCH_PRESETS: Record<SearchPreset, PresetOverrides> = {
  'a-la-une': {
    class: ['text'],
    langs: ['fr'],
    slug: ['afp', 'actualites'],
    dateFrom: 'now-1d',
    size: 1,
    genreid: AGENDA_GENRE_EXCLUSIONS,
  },
  'agenda': {
    class: ['text'],
    size: 5,
    genreid: ['afpattribute:Agenda'],
  },
  'previsions': {
    class: ['text'],
    size: 5,
    genreid: ['afpattribute:Program', 'afpedtype:TextProgram'],
  },
  'major-stories': {
    class: ['text'],
    genreid: ['afpattribute:Article'],
  },
  'factcheck': {
    class: ['factcheck'],
  },
};

export function formatErrorMessage(context: string, error: unknown, hint: string): string {
  // Log the full error server-side only — never expose internal details to the client.
  console.error(`[afp_tool] Error ${context}:`, error);
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return `Error ${context}: ${message}. ${hint}`;
}

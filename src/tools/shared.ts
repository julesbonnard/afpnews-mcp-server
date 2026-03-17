import { z } from 'zod';
import { ALL_DOC_FIELDS } from '../utils/types.js';

// UNO format: newsml.afp.com.20260222T090659Z.doc-98hu39e
//   - timestamp: 20260222T090659Z → 2026-02-22 09:06:59 UTC
//   - afpshortid: the segment after "doc-" (e.g. 98hu39e)
// Published date and afpshortid are encoded in the UNO — no need to fetch them as separate fields.
export const UNO_FORMAT_NOTE = `Note on the UNO identifier (e.g. newsml.afp.com.20260222T090659Z.doc-98hu39e):
  - Publication date: the timestamp segment, e.g. 20260222T090659Z → 2026-02-22 09:06:59 UTC
  - Short ID (afpshortid): the segment after "doc-", e.g. 98hu39e
  Both are embedded in the UNO — request afpshortid or published as explicit fields only if needed.`;

export const outputFormatEnum = z.enum(['markdown', 'json', 'csv']);
export type OutputFormat = z.infer<typeof outputFormatEnum>;

export const docFieldEnum = z.enum(ALL_DOC_FIELDS);

const SEARCH_PRESET_VALUES = ['a-la-une', 'agenda', 'previsions', 'major-stories'] as const;
export const searchPresetEnum = z.enum(SEARCH_PRESET_VALUES);
type SearchPreset = z.infer<typeof searchPresetEnum>;

const LIST_PRESET_VALUES = ['trending-topics'] as const;
export const listPresetEnum = z.enum(LIST_PRESET_VALUES);

export const langEnum = z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']);

const MEDIA_CLASS_VALUES = ['picture', 'video', 'graphic', 'videography'] as const;
export const mediaClassEnum = z.enum(MEDIA_CLASS_VALUES);
export type MediaClass = z.infer<typeof mediaClassEnum>;

const RENDITION_VALUES = ['thumbnail', 'preview', 'highdef'] as const;
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

export interface FacetResult {
  name: string;
  count: number;
}

export const GENRE_EXCLUSIONS = {
  exclude: [
    'afpgenre:Agenda',
    'afpattribute:Agenda',
    'afpattribute:Program',
    'afpattribute:TextProgram',
    'afpattribute:AdvisoryUpdate',
    'afpattribute:Advice',
    'afpattribute:SpecialAnnouncement',
    'afpattribute:PictureProgram',
  ],
};

interface PresetOverrides {
  class?: string[];
  lang?: string[];
  slug?: string[];
  dateFrom?: string;
  size?: number;
  genreid?: Record<string, string[]> | string[];
}

export const SEARCH_PRESETS: Record<SearchPreset, PresetOverrides> = {
  'a-la-une': {
    class: ['text'],
    lang: ['fr'],
    slug: ['afp', 'actualites'],
    dateFrom: 'now-1d',
    size: 1,
    genreid: GENRE_EXCLUSIONS,
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
};

export function formatErrorMessage(context: string, error: unknown, hint: string): string {
  // Log the full error server-side only — never expose internal details to the client.
  console.error(`[afp_tool] Error ${context}:`, error);
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return `Error ${context}: ${message}. ${hint}`;
}

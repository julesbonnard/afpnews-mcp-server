import { z } from 'zod';
import {
  formatDocument,
  GENRE_EXCLUSIONS,
} from '../utils/format.js';
import type { TextContent } from '../utils/types.js';
import { ALL_DOC_FIELDS, DEFAULT_OUTPUT_FIELDS } from '../utils/types.js';

export { ALL_DOC_FIELDS, DEFAULT_OUTPUT_FIELDS };

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

interface PresetOverrides {
  product?: string[];
  lang?: string[];
  slug?: string[];
  dateFrom?: string;
  size?: number;
  genreid?: Record<string, string[]> | string[];
}

export const SEARCH_PRESETS: Record<SearchPreset, PresetOverrides> = {
  'a-la-une': {
    product: ['news'],
    lang: ['fr'],
    slug: ['afp', 'actualites'],
    dateFrom: 'now-1d',
    size: 1,
    genreid: GENRE_EXCLUSIONS,
  },
  'agenda': {
    product: ['news'],
    size: 5,
    genreid: ['afpattribute:Agenda'],
  },
  'previsions': {
    product: ['news'],
    size: 5,
    genreid: ['afpattribute:Program', 'afpedtype:TextProgram'],
  },
  'major-stories': {
    product: ['news'],
    genreid: ['afpattribute:Article'],
  },
};

export function formatErrorMessage(context: string, error: unknown, hint: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error ${context}: ${message}. ${hint}`;
}

export function formatDocuments(documents: unknown[], fullText: boolean): TextContent[] {
  return documents.map((doc) => formatDocument(doc, fullText));
}

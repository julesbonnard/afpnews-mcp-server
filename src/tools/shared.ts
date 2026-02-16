import { z } from 'zod';
import {
  formatDocument,
  GENRE_EXCLUSIONS,
} from '../utils/format.js';
import type { TextContent } from '../utils/types.js';

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
  key: string;
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

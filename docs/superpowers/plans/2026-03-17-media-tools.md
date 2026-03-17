# AFP Media Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter deux outils MCP (`afp_search_media`, `afp_get_media`) pour chercher et afficher des photos/vidéos/infographies AFP, et corriger `afp_search_articles` pour utiliser le facet `class` au lieu de `product`.

**Architecture:** Les types media sont ajoutés dans `utils/types.ts`, les formateurs dans un nouveau `utils/format-media.ts`, chaque outil dans son propre fichier `tools/`. Le pattern existant (outil = définition + handler, enregistrement dans `tools/index.ts`) est conservé strictement.

**Tech Stack:** TypeScript ESM strict, Zod, `afpnews-api` (ApiCore), `@modelcontextprotocol/sdk`, vitest, pnpm.

---

## Chunk 1 : Fondations — types et shared

### Task 1 : Mise à jour de `src/utils/types.ts`

**Files:**
- Modify: `src/utils/types.ts`

- [ ] **Step 1.1 : Écrire le test des nouveaux types**

Créer `src/__tests__/types-media.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import type { AFPMediaDocument, MediaRendition, MediaRenditions, ImageContent, AnyContent, ToolSuccess } from '../utils/types.js';

describe('AFPMediaDocument type', () => {
  it('accepts a full media document', () => {
    const doc: AFPMediaDocument = {
      uno: 'newsml.afp.com.20260316T202634Z.doc-a3jc2qq',
      title: 'TOPSHOT-FBL-ENG',
      caption: 'A footballer heads the ball.',
      creditLine: 'JOHN DOE / AFP',
      creator: 'JOHN DOE',
      country: 'GBR',
      city: 'London',
      published: '2026-03-16T22:11:26Z',
      urgency: 3,
      class: 'picture',
      aspectRatios: ['afparatio:horizontal'],
      advisory: 'RESTRICTED TO EDITORIAL USE',
      renditions: {
        thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590, afpType: 'Photo' },
        preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800 },
        highdef:   { href: 'https://example.com/hd.jpg',    width: 3429, height: 2286 },
      },
    };
    expect(doc.uno).toBe('newsml.afp.com.20260316T202634Z.doc-a3jc2qq');
    expect(doc.renditions.thumbnail?.width).toBe(320);
    expect(doc.renditions.thumbnail?.afpType).toBe('Photo');
  });

  it('accepts a minimal media document (only uno + renditions required)', () => {
    const doc: AFPMediaDocument = { uno: 'TEST', renditions: {} };
    expect(doc.uno).toBe('TEST');
  });

  it('ImageContent has type "image", data string, mimeType string', () => {
    const img: ImageContent = { type: 'image', data: 'base64==', mimeType: 'image/jpeg' };
    expect(img.type).toBe('image');
  });

  it('ToolSuccess accepts mixed AnyContent array', () => {
    const success: ToolSuccess = {
      content: [
        { type: 'text', text: 'metadata' },
        { type: 'image', data: 'base64==', mimeType: 'image/jpeg' },
      ],
    };
    expect(success.content).toHaveLength(2);
  });
});
```

- [ ] **Step 1.2 : Vérifier que le test échoue**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test -- src/__tests__/types-media.test.ts
```
Attendu : erreur TypeScript (types non définis).

- [ ] **Step 1.3 : Ajouter les types dans `src/utils/types.ts`**

Ajouter à la fin du fichier (après les exports existants) :

```typescript
export interface MediaRendition {
  href: string;
  width: number;
  height: number;
  sizeInBytes?: number;
  afpType?: string;  // AFP 'type' field (e.g. 'Photo', 'Graphic') — used for MIME type inference
}

export interface MediaRenditions {
  thumbnail?: MediaRendition;
  preview?: MediaRendition;
  highdef?: MediaRendition;
}

export interface AFPMediaDocument {
  uno: string;
  title?: string;
  caption?: string;
  creditLine?: string;
  creator?: string;
  country?: string;
  city?: string;
  published?: string;
  urgency?: number;
  class?: string;
  aspectRatios?: string[];
  advisory?: string;
  renditions: MediaRenditions;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type AnyContent = TextContent | ImageContent;
```

Modifier `ToolSuccess` existant :

```typescript
// Avant
export interface ToolSuccess {
  content: TextContent[];
}

// Après
export interface ToolSuccess {
  content: AnyContent[];
}
```

- [ ] **Step 1.4 : Vérifier que le test passe**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test -- src/__tests__/types-media.test.ts
```
Attendu : PASS (4 tests).

- [ ] **Step 1.5 : Vérifier que les tests existants passent toujours**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test
```
Attendu : tous les tests passent (la modification de `ToolSuccess` est rétrocompatible).

- [ ] **Step 1.6 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/utils/types.ts src/__tests__/types-media.test.ts
git commit -m "feat(types): add AFPMediaDocument, MediaRenditions, ImageContent, AnyContent"
```

---

### Task 2 : Mise à jour de `src/tools/shared.ts`

**Files:**
- Modify: `src/tools/shared.ts`

- [ ] **Step 2.1 : Ajouter `mediaClassEnum`, `renditionEnum` et exporter `facetParamValueSchema`**

Dans `src/tools/shared.ts`, après `export const langEnum = ...` :

```typescript
const MEDIA_CLASS_VALUES = ['picture', 'video', 'graphic'] as const;
export const mediaClassEnum = z.enum(MEDIA_CLASS_VALUES);
export type MediaClass = z.infer<typeof mediaClassEnum>;

const RENDITION_VALUES = ['thumbnail', 'preview', 'highdef'] as const;
export const renditionEnum = z.enum(RENDITION_VALUES);
export type RenditionKey = z.infer<typeof renditionEnum>;
```

Exporter `facetParamValueSchema` depuis `shared.ts` (déjà défini dans `search-articles.ts` — le déplacer ici pour éviter la duplication) :

```typescript
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
```

Puis dans `src/tools/search-articles.ts`, supprimer la définition locale de `facetParamValueSchema` et l'importer depuis `shared.ts` :

```typescript
import { ..., facetParamValueSchema } from './shared.js';
```

- [ ] **Step 2.2 : Mettre à jour `PresetOverrides` et `SEARCH_PRESETS`**

Remplacer l'interface `PresetOverrides` et la constante `SEARCH_PRESETS` :

```typescript
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
```

- [ ] **Step 2.3 : Vérifier la compilation**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build
```
Attendu : build sans erreur.

- [ ] **Step 2.4 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/tools/shared.ts
git commit -m "feat(shared): add mediaClassEnum, renditionEnum; migrate PresetOverrides to class"
```

---

### Task 3 : Correction de `src/tools/search-articles.ts`

**Files:**
- Modify: `src/tools/search-articles.ts`

- [ ] **Step 3.1 : Remplacer le filtre `product` par `class`**

Dans le handler de `afpSearchArticlesTool`, remplacer :

```typescript
// Avant
const facetFilters = {
  product: ['news', 'factcheck'],
  genreid: GENRE_EXCLUSIONS,
  ...(facets ?? {}),
};

// Après
const facetFilters = {
  class: ['text'],
  genreid: GENRE_EXCLUSIONS,
  ...(facets ?? {}),
};
```

- [ ] **Step 3.2 : Vérifier la compilation et les tests**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build && pnpm test
```
Attendu : build + tests passent.

- [ ] **Step 3.3 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/tools/search-articles.ts
git commit -m "fix(search-articles): use class: ['text'] instead of product filter"
```

---

## Chunk 2 : Formateurs media

### Task 4 : Créer `src/utils/format-media.ts`

**Files:**
- Create: `src/utils/format-media.ts`
- Create: `src/__tests__/format-media.test.ts`

- [ ] **Step 4.1 : Écrire les tests**

Créer `src/__tests__/format-media.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { extractRenditions, formatMediaDocument, formatMediaDocumentsAsJson, MEDIA_RENDITION_ROLE_MAP } from '../utils/format-media.js';

// Fixture bagItem reprenant la structure réelle AFP
const FIXTURE_BAG_ITEM = [{
  medias: [
    { role: 'Thumbnail',  sizeInBytes: 33590,   width: 320,  height: 213,  href: 'https://example.com/thumb.jpg',   type: 'Photo' },
    { role: 'Preview',    sizeInBytes: 340621,  width: 1200, height: 800,  href: 'https://example.com/prev.jpg',    type: 'Photo' },
    { role: 'Preview_B',  sizeInBytes: 596996,  width: 1800, height: 1200, href: 'https://example.com/prev_b.jpg',  type: 'Photo' },
    { role: 'HighDef',    sizeInBytes: 5126566, width: 3429, height: 2286, href: 'https://example.com/hd.jpg',      type: 'Photo' },
    { role: 'Quicklook',  sizeInBytes: 14055,   width: 245,  height: 164,  href: 'https://example.com/quick.jpg',  type: 'Photo' },
  ],
}];

const FIXTURE_BAG_NO_PREVIEW = [{
  medias: [
    { role: 'Thumbnail', sizeInBytes: 33590, width: 320, height: 213, href: 'https://example.com/thumb.jpg', type: 'Photo' },
    { role: 'Preview_B', sizeInBytes: 596996, width: 1800, height: 1200, href: 'https://example.com/prev_b.jpg', type: 'Photo' },
    { role: 'HighDef',   sizeInBytes: 5126566, width: 3429, height: 2286, href: 'https://example.com/hd.jpg', type: 'Photo' },
  ],
}];

describe('MEDIA_RENDITION_ROLE_MAP', () => {
  it('maps Thumbnail → thumbnail', () => expect(MEDIA_RENDITION_ROLE_MAP['Thumbnail']).toBe('thumbnail'));
  it('maps Preview → preview', () => expect(MEDIA_RENDITION_ROLE_MAP['Preview']).toBe('preview'));
  it('maps Preview_B → preview', () => expect(MEDIA_RENDITION_ROLE_MAP['Preview_B']).toBe('preview'));
  it('maps Preview_W → preview', () => expect(MEDIA_RENDITION_ROLE_MAP['Preview_W']).toBe('preview'));
  it('maps HighDef → highdef', () => expect(MEDIA_RENDITION_ROLE_MAP['HighDef']).toBe('highdef'));
});

describe('extractRenditions', () => {
  it('returns {} for empty bagItem', () => {
    expect(extractRenditions([])).toEqual({});
  });

  it('returns {} for missing medias', () => {
    expect(extractRenditions([{}])).toEqual({});
  });

  it('extracts thumbnail, preview, highdef from standard bagItem', () => {
    const r = extractRenditions(FIXTURE_BAG_ITEM);
    expect(r.thumbnail?.href).toBe('https://example.com/thumb.jpg');
    expect(r.thumbnail?.width).toBe(320);
    expect(r.thumbnail?.sizeInBytes).toBe(33590);
    expect(r.preview?.href).toBe('https://example.com/prev.jpg');
    expect(r.preview?.width).toBe(1200);
    expect(r.highdef?.href).toBe('https://example.com/hd.jpg');
  });

  it('Preview takes priority over Preview_B for the preview slot', () => {
    const r = extractRenditions(FIXTURE_BAG_ITEM);
    expect(r.preview?.width).toBe(1200); // Preview, not Preview_B (1800)
  });

  it('falls back to Preview_B when Preview is absent', () => {
    const r = extractRenditions(FIXTURE_BAG_NO_PREVIEW);
    expect(r.preview?.href).toBe('https://example.com/prev_b.jpg');
    expect(r.preview?.width).toBe(1800);
  });

  it('ignores unknown roles (Quicklook)', () => {
    const r = extractRenditions(FIXTURE_BAG_ITEM);
    expect(Object.keys(r)).not.toContain('quicklook');
  });

  it('uses first bagItem only (index 0)', () => {
    const twoBags = [FIXTURE_BAG_ITEM[0], { medias: [{ role: 'Thumbnail', href: 'https://other.com/thumb.jpg', width: 100, height: 100 }] }];
    const r = extractRenditions(twoBags);
    expect(r.thumbnail?.href).toBe('https://example.com/thumb.jpg');
  });
});

describe('formatMediaDocument', () => {
  const doc = {
    uno: 'newsml.afp.com.20260316T202634Z.doc-a3jc2qq',
    title: 'TOPSHOT-FBL-ENG',
    caption: 'A footballer heads the ball.',
    creditLine: 'JOHN DOE / AFP',
    creator: 'JOHN DOE',
    country: 'GBR',
    city: 'London',
    published: '2026-03-16T22:11:26Z',
    class: 'picture',
    urgency: 3,
    advisory: 'RESTRICTED TO EDITORIAL USE',
    renditions: {
      thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213 },
      preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800 },
      highdef:   { href: 'https://example.com/hd.jpg',    width: 3429, height: 2286 },
    },
  };

  it('returns { type: "text", text: string }', () => {
    const r = formatMediaDocument(doc);
    expect(r.type).toBe('text');
    expect(typeof r.text).toBe('string');
  });

  it('includes ## title heading', () => {
    expect(formatMediaDocument(doc).text).toContain('## TOPSHOT-FBL-ENG');
  });

  it('includes metadata line (UNO, class, creditLine, city, country)', () => {
    const t = formatMediaDocument(doc).text;
    expect(t).toContain('newsml.afp.com.20260316T202634Z.doc-a3jc2qq');
    expect(t).toContain('picture');
    expect(t).toContain('JOHN DOE / AFP');
    expect(t).toContain('London');
    expect(t).toContain('GBR');
  });

  it('includes inline thumbnail image', () => {
    const t = formatMediaDocument(doc).text;
    expect(t).toContain('![A footballer heads the ball.](https://example.com/thumb.jpg)');
  });

  it('includes preview and highdef links', () => {
    const t = formatMediaDocument(doc).text;
    expect(t).toContain('[Preview 1200px](https://example.com/prev.jpg)');
    expect(t).toContain('[HighDef 3429px](https://example.com/hd.jpg)');
  });

  it('includes advisory as blockquote', () => {
    expect(formatMediaDocument(doc).text).toContain('> RESTRICTED TO EDITORIAL USE');
  });

  it('handles missing renditions gracefully', () => {
    const minimal = { uno: 'TEST', renditions: {} };
    const r = formatMediaDocument(minimal);
    expect(r.type).toBe('text');
    expect(r.text).toContain('TEST');
  });
});

describe('formatMediaDocumentsAsCsv', () => {
  it('includes header row with correct columns', () => {
    const r = formatMediaDocumentsAsCsv([]);
    expect(r.content.text).toContain('uno,title,caption,creditLine,published,class,thumbnail_href');
  });

  it('includes document values in correct column order', () => {
    const docs = [{
      uno: 'newsml.test',
      title: 'My Photo',
      caption: 'A nice caption',
      creditLine: 'JANE / AFP',
      published: '2026-03-16T10:00:00Z',
      class: 'picture',
      renditions: { thumbnail: { href: 'https://example.com/t.jpg', width: 320, height: 213 } },
    }];
    const r = formatMediaDocumentsAsCsv(docs as any);
    expect(r.content.text).toContain('newsml.test');
    expect(r.content.text).toContain('My Photo');
    expect(r.content.text).toContain('JANE / AFP');
    expect(r.content.text).toContain('https://example.com/t.jpg');
  });

  it('escapes commas and quotes in field values', () => {
    const docs = [{
      uno: 'newsml.test',
      caption: 'A caption, with "quotes"',
      renditions: {},
    }];
    const r = formatMediaDocumentsAsCsv(docs as any);
    expect(r.content.text).toContain('"A caption, with ""quotes"""');
  });

  it('handles missing thumbnail href gracefully', () => {
    const docs = [{ uno: 'newsml.test', renditions: {} }];
    const r = formatMediaDocumentsAsCsv(docs as any);
    expect(r.content.text).toContain('newsml.test');
  });
});

describe('formatMediaDocumentsAsJson', () => {
  const docs = [
    { uno: 'A', renditions: { thumbnail: { href: 'https://t.jpg', width: 320, height: 213 } } },
    { uno: 'B', renditions: {} },
  ];

  it('returns { content: TextContent, truncated: boolean }', () => {
    const r = formatMediaDocumentsAsJson(docs as any);
    expect(r.content.type).toBe('text');
    expect(typeof r.truncated).toBe('boolean');
  });

  it('output JSON contains total metadata and documents array', () => {
    const r = formatMediaDocumentsAsJson(docs as any, { total: 100, offset: 0 });
    const parsed = JSON.parse(r.content.text);
    expect(parsed.total).toBe(100);
    expect(parsed.offset).toBe(0);
    expect(parsed.shown).toBe(2);
    expect(parsed.truncated).toBe(false);
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents[0].uno).toBe('A');
  });

  it('truncated flag is false when content is small', () => {
    const r = formatMediaDocumentsAsJson(docs as any, { total: 100, offset: 0 });
    expect(r.truncated).toBe(false);
  });

  it('truncates when content exceeds CHARACTER_LIMIT', () => {
    // Generate a large doc list that will exceed 25k chars
    const largeDocs = Array.from({ length: 500 }, (_, i) => ({
      uno: `newsml.afp.com.2026031${i}T202634Z.doc-abcdefg`,
      title: 'A very long title that takes up space in the JSON output',
      caption: 'A very long caption that also takes up considerable space in the JSON output here',
      renditions: { thumbnail: { href: `https://example.com/thumb-${i}.jpg`, width: 320, height: 213 } },
    }));
    const r = formatMediaDocumentsAsJson(largeDocs as any, { total: 500, offset: 0 });
    expect(r.truncated).toBe(true);
    const parsed = JSON.parse(r.content.text);
    expect(parsed.shown).toBeLessThan(500);
  });
});
```

- [ ] **Step 4.2 : Vérifier que les tests échouent**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test -- src/__tests__/format-media.test.ts
```
Attendu : FAIL (module non trouvé).

- [ ] **Step 4.3 : Créer `src/utils/format-media.ts`**

```typescript
import type { AFPMediaDocument, MediaRenditions, MediaRendition, TextContent } from './types.js';
import { textContent, truncateToLimit } from './format.js';

// Mapping role AFP → clé normalisée (utilise m.role, pas m.rendition)
// Preview est prioritaire sur Preview_B/Preview_W (premier match gagne)
export const MEDIA_RENDITION_ROLE_MAP: Record<string, keyof MediaRenditions> = {
  'Thumbnail': 'thumbnail',
  'Preview':   'preview',
  'Preview_B': 'preview',
  'Preview_W': 'preview',
  'HighDef':   'highdef',
};

export function extractRenditions(bagItem: unknown): MediaRenditions {
  if (!Array.isArray(bagItem) || bagItem.length === 0) return {};
  const medias: any[] = (bagItem[0] as any)?.medias ?? [];
  const result: MediaRenditions = {};

  for (const m of medias) {
    const key = MEDIA_RENDITION_ROLE_MAP[m.role as string];
    if (!key) continue;
    if (result[key]) continue; // ne pas écraser (Preview prioritaire sur Preview_B/W)
    result[key] = {
      href: m.href,
      width: m.width,
      height: m.height,
      sizeInBytes: m.sizeInBytes,
      afpType: m.type,  // e.g. 'Photo', 'Graphic' — used for MIME type inference
    } satisfies MediaRendition;
  }

  return result;
}

export function formatMediaDocument(doc: Partial<AFPMediaDocument> & { uno: string; renditions: MediaRenditions }): TextContent {
  const meta: string[] = [
    `UNO: ${doc.uno}`,
    ...(doc.class ? [`Class: ${doc.class}`] : []),
    ...(doc.creditLine ? [doc.creditLine] : []),
    ...((doc.city || doc.country) ? [`${[doc.city, doc.country].filter(Boolean).join(', ')}`] : []),
    ...(doc.published ? [doc.published.slice(0, 10)] : []),
  ];

  const lines: string[] = [];
  if (doc.title) lines.push(`## ${doc.title}`);
  lines.push(`*${meta.join(' | ')}*`);
  lines.push('');

  const { thumbnail, preview, highdef } = doc.renditions;
  const caption = doc.caption ?? '';

  if (thumbnail) {
    lines.push(`![${caption}](${thumbnail.href})`);
    lines.push('');
  }

  const links: string[] = [];
  if (preview) links.push(`[Preview ${preview.width}px](${preview.href})`);
  if (highdef) links.push(`[HighDef ${highdef.width}px](${highdef.href})`);
  if (links.length > 0) {
    lines.push(links.join(' | '));
    lines.push('');
  }

  if (doc.advisory) {
    lines.push(`> ${doc.advisory}`);
  }

  return textContent(lines.join('\n').trimEnd());
}

export function formatMediaDocumentsAsJson(
  docs: AFPMediaDocument[],
  meta: Record<string, unknown> = {},
): { content: TextContent; truncated: boolean } {
  const { text, truncated } = truncateToLimit(
    docs,
    (slice) => JSON.stringify({
      ...meta,
      shown: slice.length,
      truncated: slice.length < docs.length,
      documents: slice,
    }, null, 2),
  );
  return { content: textContent(text), truncated };
}

export function formatMediaDocumentsAsCsv(docs: AFPMediaDocument[]): { content: TextContent; truncated: boolean } {
  const header = 'uno,title,caption,creditLine,published,class,thumbnail_href';
  const escape = (v: unknown) => {
    const str = String(v ?? '');
    if (/[",\n\r]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
    return str;
  };
  const rows = docs.map((d) => [
    escape(d.uno),
    escape(d.title),
    escape(d.caption),
    escape(d.creditLine),
    escape(d.published),
    escape(d.class),
    escape(d.renditions.thumbnail?.href),
  ].join(','));

  const { text, truncated } = truncateToLimit(
    rows,
    (slice) => [header, ...slice].join('\n'),
  );
  return { content: textContent(text), truncated };
}
```

- [ ] **Step 4.4 : Vérifier que les tests passent**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test -- src/__tests__/format-media.test.ts
```
Attendu : tous les tests PASS.

- [ ] **Step 4.5 : Vérifier la compilation complète**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build
```
Attendu : build sans erreur.

- [ ] **Step 4.6 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/utils/format-media.ts src/__tests__/format-media.test.ts
git commit -m "feat(format-media): add extractRenditions, formatMediaDocument, json/csv formatters"
```

---

## Chunk 3 : Outils MCP

### Task 5 : Créer `src/tools/search-media.ts`

**Files:**
- Create: `src/tools/search-media.ts`

- [ ] **Step 5.1 : Créer le fichier**

```typescript
import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { textContent, toolError, TRUNCATION_HINT } from '../utils/format.js';
import {
  formatMediaDocument,
  formatMediaDocumentsAsJson,
  formatMediaDocumentsAsCsv,
  extractRenditions,
} from '../utils/format-media.js';
import type { AFPMediaDocument } from '../utils/types.js';
import { DEFAULT_SEARCH_SIZE } from '../utils/types.js';
import { buildPaginationLine } from '../utils/format.js';
import {
  mediaClassEnum,
  outputFormatEnum,
  formatErrorMessage,
  facetParamValueSchema,
} from './shared.js';

const reservedMediaFacetKeys = new Set(['class', 'format', 'query', 'size', 'sortOrder', 'offset', 'facets']);

const MEDIA_API_FIELDS = [
  'uno', 'title', 'caption', 'creditLine', 'creator',
  'country', 'city', 'published', 'urgency', 'class',
  'aspectRatios', 'advisory', 'bagItem',
] as const;

const inputSchema = z.object({
  class: mediaClassEnum.optional().describe("Media class filter: 'picture', 'video', or 'graphic'. Omit to search all media types."),
  query: z.string().optional().describe("Search keywords (e.g. 'football london')"),
  size: z.number().optional().describe('Number of results (default 10, max 1000)'),
  offset: z.number().optional().describe('Pagination offset'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
  format: outputFormatEnum.optional().describe('Output format: markdown (default), json, or csv'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe(
    "Additional AFP facet filters (e.g. { lang: ['fr'], country: ['fra'], dateFrom: '2026-01-01' })"
  ),
}).strict().superRefine((value, ctx) => {
  for (const key of Object.keys(value.facets ?? {})) {
    if (reservedMediaFacetKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['facets', key],
        message: `Facet key "${key}" is reserved and must be provided at top-level.`,
      });
    }
  }
});

type SearchMediaInput = z.infer<typeof inputSchema>;

function buildMediaDocument(raw: any): AFPMediaDocument {
  return {
    uno: raw.uno,
    title: raw.title,
    caption: Array.isArray(raw.caption) ? raw.caption[0] : raw.caption,
    creditLine: raw.creditLine,
    creator: raw.creator,
    country: raw.country,
    city: raw.city,
    published: raw.published,
    urgency: raw.urgency,
    class: raw.class,
    aspectRatios: raw.aspectRatios,
    advisory: raw.advisory,
    renditions: extractRenditions(raw.bagItem ?? []),
  };
}

export const afpSearchMediaTool = {
  name: 'afp_search_media',
  title: 'Search AFP Media (Photos, Videos, Graphics)',
  description: `Search AFP photos, videos, and infographics. Returns rendition URLs for gallery display.

Args:
  - class: 'picture', 'video', or 'graphic' (omit to search all media types)
  - query: Search keywords
  - size: Number of results (default 10)
  - offset: Pagination offset
  - sortOrder: 'asc' or 'desc' (default 'desc')
  - format: markdown (default, with inline thumbnails), json (structured with rendition URLs), csv
  - facets: Additional AFP filters (e.g. { lang: ['fr'], country: ['fra'], dateFrom: '2026-01-01' })

Returns (json):
  { total, shown, offset, truncated, documents: [{ uno, title, caption, creditLine, creator,
    country, city, published, urgency, class, aspectRatios, advisory,
    renditions: { thumbnail, preview, highdef } }] }

Rendition sizes:
  - thumbnail: ~320px wide (gallery grid)
  - preview: ~1200px wide (display)
  - highdef: ~3400px wide (download / analysis)

Examples:
  - AFP football photos: { class: "picture", query: "football", facets: { lang: ["en"] } }
  - All media on a topic: { query: "climate protest", format: "json" }
  - Export gallery CSV: { class: "picture", query: "Paris", format: "csv" }`,
  inputSchema,
  handler: async (
    apicore: ApiCore,
    { class: mediaClass, query, size = DEFAULT_SEARCH_SIZE, offset, sortOrder = 'desc', format = 'markdown', facets }: SearchMediaInput,
  ) => {
    try {
      const classFilter = mediaClass ? [mediaClass] : ['picture', 'video', 'graphic'];
      const request: Record<string, unknown> = {
        query,
        size,
        sortOrder,
        startAt: offset,
        class: classFilter,
        ...(facets ?? {}),
      };

      const { documents: rawDocs, count } = await apicore.search(request as any, [...MEDIA_API_FIELDS]);

      if (count === 0) {
        return { content: [textContent('No results found.')] };
      }

      const docs = (rawDocs as any[]).map(buildMediaDocument);
      const currentOffset = offset ?? 0;

      if (format === 'json') {
        const { content, truncated } = formatMediaDocumentsAsJson(docs, { total: count, offset: currentOffset });
        const result = [content];
        if (truncated) result.push(textContent(TRUNCATION_HINT));
        return { content: result };
      }

      if (format === 'csv') {
        const { content, truncated } = formatMediaDocumentsAsCsv(docs);
        const result = [content];
        if (truncated) result.push(textContent(TRUNCATION_HINT));
        return { content: result };
      }

      // markdown
      const items = docs.map(formatMediaDocument);
      return {
        content: [
          textContent(buildPaginationLine(docs.length, count, currentOffset)),
          ...items,
        ],
      };
    } catch (error) {
      return toolError(formatErrorMessage('searching AFP media', error, 'Check your query parameters and try again.'));
    }
  },
};
```

- [ ] **Step 5.2 : Vérifier la compilation**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build
```
Attendu : build sans erreur.

- [ ] **Step 5.3 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/tools/search-media.ts
git commit -m "feat(tools): add afp_search_media tool"
```

---

### Task 6 : Créer `src/tools/get-media.ts`

**Files:**
- Create: `src/tools/get-media.ts`

- [ ] **Step 6.1 : Écrire les tests de la logique interne**

Créer `src/__tests__/get-media.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { inferMimeType, selectRenditionForEmbed } from '../tools/get-media.js';
import type { MediaRenditions } from '../utils/types.js';

describe('inferMimeType', () => {
  it('maps AFP type "Photo" → image/jpeg (priority over URL extension)', () => {
    expect(inferMimeType('Photo', 'https://example.com/img.jpg')).toBe('image/jpeg');
  });
  it('maps AFP type "Graphic" → image/png', () => {
    expect(inferMimeType('Graphic', 'https://example.com/img.png')).toBe('image/png');
  });
  it('falls back to URL extension .png → image/png when afpType undefined', () => {
    expect(inferMimeType(undefined, 'https://example.com/img.png')).toBe('image/png');
  });
  it('falls back to URL extension .webp → image/webp', () => {
    expect(inferMimeType(undefined, 'https://example.com/img.webp')).toBe('image/webp');
  });
  it('strips query string before checking extension', () => {
    expect(inferMimeType(undefined, 'https://example.com/img.jpg?token=abc123')).toBe('image/jpeg');
  });
  it('falls back to image/jpeg for unknown extension', () => {
    expect(inferMimeType(undefined, 'https://example.com/img?token=abc')).toBe('image/jpeg');
  });
});

describe('selectRenditionForEmbed', () => {
  const renditions: MediaRenditions = {
    thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590 },
    preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800, sizeInBytes: 340621 },
    highdef:   { href: 'https://example.com/hd.jpg',    width: 3429, height: 2286, sizeInBytes: 5126566 },
  };

  it('returns requested rendition when available and under size limit', () => {
    const r = selectRenditionForEmbed(renditions, 'preview');
    expect(r?.href).toBe('https://example.com/prev.jpg');
  });

  it('downgrades to thumbnail when selected rendition exceeds 5MB', () => {
    const r = selectRenditionForEmbed(renditions, 'highdef');
    // highdef is 5126566 bytes (> 5000000) → downgrade to thumbnail
    expect(r?.href).toBe('https://example.com/thumb.jpg');
  });

  it('falls back to preview then thumbnail when requested rendition absent', () => {
    const noHighdef: MediaRenditions = {
      thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590 },
      preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800, sizeInBytes: 340621 },
    };
    const r = selectRenditionForEmbed(noHighdef, 'highdef');
    expect(r?.href).toBe('https://example.com/prev.jpg');
  });

  it('returns thumbnail when all larger renditions absent', () => {
    const thumbOnly: MediaRenditions = {
      thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590 },
    };
    const r = selectRenditionForEmbed(thumbOnly, 'preview');
    expect(r?.href).toBe('https://example.com/thumb.jpg');
  });

  it('returns undefined when no renditions available', () => {
    const r = selectRenditionForEmbed({}, 'preview');
    expect(r).toBeUndefined();
  });
});
```

- [ ] **Step 6.2 : Vérifier que les tests échouent**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test -- src/__tests__/get-media.test.ts
```
Attendu : FAIL (module non trouvé).

- [ ] **Step 6.3 : Créer `src/tools/get-media.ts`**

```typescript
import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { textContent, toolError } from '../utils/format.js';
import { extractRenditions } from '../utils/format-media.js';
import type { MediaRendition, MediaRenditions, ImageContent } from '../utils/types.js';
import { renditionEnum, formatErrorMessage } from './shared.js';

// Exported for testing
export function inferMimeType(afpType: string | undefined, href: string): string {
  if (afpType === 'Photo') return 'image/jpeg';
  if (afpType === 'Graphic') return 'image/png';
  const ext = href.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/jpeg';
}

// Exported for testing
export function selectRenditionForEmbed(
  renditions: MediaRenditions,
  requested: 'thumbnail' | 'preview' | 'highdef',
): MediaRendition | undefined {
  const SIZE_LIMIT = 5_000_000;

  const get = (key: keyof MediaRenditions): MediaRendition | undefined => renditions[key];

  // Try requested rendition, then fallback chain
  const candidate = get(requested) ?? get('preview') ?? get('thumbnail');
  if (!candidate) return undefined;

  // Downgrade if over size limit (only once)
  if ((candidate.sizeInBytes ?? 0) > SIZE_LIMIT) {
    return get('thumbnail') ?? candidate; // proceed with candidate if no thumbnail
  }

  return candidate;
}

const inputSchema = z.object({
  uno: z.string().describe('AFP document UNO identifier (e.g. newsml.afp.com.20260316T202634Z.doc-a3jc2qq)'),
  embed: z.boolean().optional().describe('When true, fetches the image and returns it as base64 for Claude vision analysis. Default: false.'),
  rendition: renditionEnum.optional().describe("Rendition size to embed: 'thumbnail' (320px), 'preview' (1200px, default), 'highdef' (~3400px)"),
});

type GetMediaInput = z.infer<typeof inputSchema>;

function formatFullMediaText(doc: any, renditions: MediaRenditions, note?: string): string {
  const lines: string[] = [];
  if (doc.title) lines.push(`## ${doc.title}`);
  lines.push(`**UNO:** ${doc.uno}`);
  if (doc.class)      lines.push(`**Class:** ${doc.class}`);
  if (doc.creditLine) lines.push(`**Credit:** ${doc.creditLine}`);
  if (doc.creator)    lines.push(`**Creator:** ${doc.creator}`);
  if (doc.published)  lines.push(`**Published:** ${doc.published}`);
  if (doc.country || doc.city) lines.push(`**Location:** ${[doc.city, doc.country].filter(Boolean).join(', ')}`);
  if (doc.urgency != null) lines.push(`**Urgency:** ${doc.urgency}`);
  if (doc.aspectRatios?.length) lines.push(`**Aspect:** ${doc.aspectRatios.join(', ')}`);

  const caption = Array.isArray(doc.caption) ? doc.caption[0] : doc.caption;
  if (caption) lines.push(`\n${caption}`);
  if (doc.advisory) lines.push(`\n> ${doc.advisory}`);

  lines.push('\n**Renditions:**');
  const { thumbnail, preview, highdef } = renditions;
  if (thumbnail) lines.push(`- thumbnail: ${thumbnail.href} (${thumbnail.width}×${thumbnail.height})`);
  if (preview)   lines.push(`- preview: ${preview.href} (${preview.width}×${preview.height})`);
  if (highdef)   lines.push(`- highdef: ${highdef.href} (${highdef.width}×${highdef.height})`);

  if (note) lines.push(`\n*${note}*`);

  return lines.join('\n');
}

export const afpGetMediaTool = {
  name: 'afp_get_media',
  title: 'Get AFP Media Document',
  description: `Retrieve a complete AFP media document by UNO. Optionally embed the image as base64 for Claude vision analysis.

Args:
  - uno: AFP document UNO (e.g. newsml.afp.com.20260316T202634Z.doc-a3jc2qq)
  - embed: When true, fetches the image and returns it as a base64 MCP image block that Claude can see and analyse visually. Default: false.
  - rendition: Size to embed — 'thumbnail' (320px), 'preview' (1200px, default), 'highdef' (~3400px).
               Files > 5 MB are automatically downgraded to thumbnail.
               Videos always use thumbnail (poster frame). SVG graphics cannot be embedded.

Returns:
  - Without embed: full metadata + all rendition URLs
  - With embed: metadata + MCP image block (Claude can analyse the image)`,
  inputSchema,
  handler: async (
    apicore: ApiCore,
    { uno, embed = false, rendition: requestedRendition = 'preview' }: GetMediaInput,
  ) => {
    try {
      const doc = await apicore.get(uno) as any;
      if (!doc) {
        return toolError(`Media document not found: ${uno}`);
      }

      const renditions = extractRenditions(doc.bagItem ?? []);
      const metadataText = textContent(formatFullMediaText(doc, renditions));

      if (!embed) {
        return { content: [metadataText] };
      }

      // Guard: SVG graphics (URL ends with .svg OR AFP type field is 'Graphic')
      const isSvg = (r: MediaRendition) => r.href.split('?')[0].endsWith('.svg') || r.afpType === 'Graphic';
      const allRenditions = Object.values(renditions).filter(Boolean) as MediaRendition[];
      if (doc.class === 'graphic' && allRenditions.some(isSvg)) {
        return {
          content: [
            metadataText,
            textContent('Warning: SVG graphics cannot be embedded for vision. Use the rendition URL directly.'),
          ],
        };
      }

      // Guard: video → use thumbnail as poster frame
      let renditionKey: 'thumbnail' | 'preview' | 'highdef' = requestedRendition;
      let note: string | undefined;
      if (doc.class === 'video') {
        renditionKey = 'thumbnail';
        note = 'Note: video embed — showing thumbnail/poster frame only.';
      }

      const chosen = selectRenditionForEmbed(renditions, renditionKey);
      if (!chosen) {
        return {
          content: [
            metadataText,
            textContent('Warning: no rendition available for embedding.'),
          ],
        };
      }

      let imageData: string;
      let mimeType: string;

      try {
        const response = await fetch(chosen.href);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        imageData = buffer.toString('base64');
        // MIME priority: AFP type field → URL extension → HTTP Content-Type → fallback
        mimeType = inferMimeType(chosen.afpType, chosen.href);
        // Override with Content-Type from response if more specific
        const ct = response.headers.get('content-type');
        if (ct && ct.startsWith('image/')) mimeType = ct.split(';')[0].trim();
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown fetch error';
        return {
          content: [
            metadataText,
            textContent(`Warning: image embed failed: ${msg}`),
          ],
        };
      }

      const imageContent: ImageContent = {
        type: 'image',
        data: imageData,
        mimeType,
      };

      const metaWithNote = note
        ? textContent(formatFullMediaText(doc, renditions, note))
        : metadataText;

      return { content: [metaWithNote, imageContent] };
    } catch (error) {
      return toolError(formatErrorMessage('retrieving AFP media document', error, 'Check the UNO identifier and try again.'));
    }
  },
};
```

- [ ] **Step 6.4 : Vérifier que les tests passent**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test -- src/__tests__/get-media.test.ts
```
Attendu : tous les tests PASS.

- [ ] **Step 6.5 : Vérifier la compilation**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build
```
Attendu : build sans erreur.

- [ ] **Step 6.6 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/tools/get-media.ts src/__tests__/get-media.test.ts
git commit -m "feat(tools): add afp_get_media tool with base64 vision embed"
```

---

## Chunk 4 : Enregistrement et docs

### Task 7 : Enregistrer les outils dans `src/tools/index.ts`

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 7.1 : Ajouter les imports et l'enregistrement**

```typescript
import { afpSearchMediaTool } from './search-media.js';
import { afpGetMediaTool } from './get-media.js';

const RAW_TOOLS = [
  afpSearchArticlesTool,
  afpGetArticleTool,
  afpFindSimilarTool,
  afpListFacetsTool,
  afpSearchMediaTool,
  afpGetMediaTool,
] as const;
```

(Le reste du fichier — `TOOL_DEFINITIONS` et `registerTools` — reste identique.)

- [ ] **Step 7.2 : Exporter les nouveaux outils depuis `src/definitions.ts`**

Dans `src/definitions.ts`, ajouter les exports nommés pour les consommateurs du sous-chemin `afpnews-mcp-server/definitions` :

```typescript
// Ajout après les imports existants
import { afpSearchMediaTool } from './tools/search-media.js';
import { afpGetMediaTool } from './tools/get-media.js';

// Ajouter à la fin du fichier
export { afpSearchMediaTool, afpGetMediaTool };
```

- [ ] **Step 7.3 : Vérifier la compilation**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build
```
Attendu : build sans erreur.

- [ ] **Step 7.4 : Vérifier tous les tests**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm test
```
Attendu : tous les tests PASS.

- [ ] **Step 7.5 : Commit**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add src/tools/index.ts src/definitions.ts
git commit -m "feat(tools): register afp_search_media and afp_get_media"
```

---

### Task 8 : Mettre à jour `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 8.1 : Ajouter les nouveaux outils dans le tableau**

Dans la section "Outils MCP disponibles", ajouter après `afp_list_facets` :

```markdown
| `afp_search_media`     | Recherche de photos, vidéos et infographies AFP avec URLs de renditions (galerie) |
| `afp_get_media`        | Récupère un media complet par UNO, avec embed base64 pour vision Claude           |
```

Mettre à jour la description de `afp_search_articles` pour mentionner `class: ['text']` :

```markdown
| `afp_search_articles`  | Outil principal de recherche d'articles texte (filtre `class: ['text']`, filtres + presets + mode fullText) |
```

- [ ] **Step 8.2 : Vérifier le build final**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && pnpm run build && pnpm test
```
Attendu : build + tous les tests PASS.

- [ ] **Step 8.3 : Commit final**

```bash
cd /Users/jbonnard/web/afpnews-mcp-server && git add CLAUDE.md
git commit -m "docs(claude-md): document afp_search_media, afp_get_media, update class filter note"
```

---

## Résumé des fichiers

| Fichier | Action |
|---------|--------|
| `src/utils/types.ts` | Modifier — +6 types/interfaces |
| `src/tools/shared.ts` | Modifier — +2 enums, PresetOverrides + SEARCH_PRESETS |
| `src/tools/search-articles.ts` | Modifier — product → class |
| `src/utils/format-media.ts` | Créer |
| `src/tools/search-media.ts` | Créer |
| `src/tools/get-media.ts` | Créer |
| `src/tools/index.ts` | Modifier — +2 enregistrements |
| `CLAUDE.md` | Modifier — +2 outils documentés |
| `src/__tests__/types-media.test.ts` | Créer |
| `src/__tests__/format-media.test.ts` | Créer |
| `src/__tests__/get-media.test.ts` | Créer |

# Design Spec — AFP Media Tools (photos, vidéos, infographies)

**Date :** 2026-03-17
**Status :** Approved
**Scope :** Deux nouveaux outils MCP (`afp_search_media`, `afp_get_media`) + correction du filtre `class` dans `afp_search_articles`

---

## Contexte

Le serveur MCP AFP expose aujourd'hui uniquement des articles texte. Le filtre hardcodé `product: ['news', 'factcheck']` dans `afp_search_articles` exclut tous les contenus media. L'API AFP utilise le facet `class` (valeurs : `text`, `picture`, `video`, `graphic`, `videographic`, `factcheck`) pour discriminer les types de documents. Les documents media exposent leurs fichiers via `bagItem[0].medias`, un tableau d'objets renditions.

Structure réelle d'un objet rendition AFP (champs confirmés sur données réelles) :
```json
{ "role": "Thumbnail",  "rendition": "rnd:thumbnail", "sizeInBytes": 33590,  "width": 320,  "height": 213,  "href": "https://...", "type": "Photo" }
{ "role": "Preview",                                   "sizeInBytes": 340621, "width": 1200, "height": 800,  "href": "https://...", "type": "Photo" }
{ "role": "Preview_B",  "rendition": "rnd:preview",   "sizeInBytes": 596996, "width": 1800, "height": 1200, "href": "https://...", "type": "Photo" }
{ "role": "Preview_W",                                 "sizeInBytes": 348796, "width": 1800, "height": 1200, "href": "https://...", "type": "Photo" }
{ "role": "HighDef",    "rendition": "rnd:highRes",   "sizeInBytes": 5126566,"width": 3429, "height": 2286, "href": "https://...", "type": "Photo" }
{ "role": "Quicklook",                                 "sizeInBytes": 14055,  "width": 245,  "height": 164,  "href": "https://...", "type": "Photo" }
{ "role": "Squared120",                                "sizeInBytes": 5241,   "width": 120,  "height": 120,  "href": "https://...", "type": "Photo" }
```

Le champ discriminant à utiliser est **`role`** (présent sur tous les objets). Le champ `rendition` est optionnel.

Objectifs :
1. Permettre la recherche de photos, vidéos et infographies AFP
2. Retourner des URLs de renditions utilisables dans une galerie web
3. Permettre l'embed base64 d'images dans la conversation Claude (vision MCP)
4. Corriger `afp_search_articles` pour utiliser `class: ['text']`

---

## Nouveaux outils

### `afp_search_media`

Recherche de documents media AFP filtrés par `class`.

**Paramètres (zod schema) :**

```typescript
const reservedMediaFacetKeys = new Set(['class', 'format', 'query', 'size', 'sortOrder', 'offset', 'facets']);

const inputSchema = z.object({
  class: mediaClassEnum.optional(),
  query: z.string().optional(),
  size: z.number().optional(),
  offset: z.number().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  format: outputFormatEnum.optional(),
  facets: z.record(z.string(), facetParamValueSchema).optional(),
}).strict().superRefine((value, ctx) => {
  for (const key of Object.keys(value.facets ?? {})) {
    if (reservedMediaFacetKeys.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['facets', key],
        message: `Facet key "${key}" is reserved and must be provided at top-level.` });
    }
  }
});
```

Si `facets` contient `class`, une erreur de validation est levée (reservedFacetKeys guard, identique au pattern de `afp_search_articles`).

**Comportement :**
- Si `class` omis : `class: ['picture', 'video', 'graphic']`
- Si `class` fourni : `class: [value]`
- Applique `extractRenditions(doc.bagItem)` pour mapper les renditions
- **Output JSON** : shape `AFPMediaDocument` complet avec `truncateToLimit` (même pattern que les outils existants, voir `formatMediaDocumentsAsJson` ci-dessous)

**Champs API demandés :**
`uno`, `title`, `caption`, `creditLine`, `creator`, `country`, `city`, `published`, `urgency`, `class`, `aspectRatios`, `advisory`, `bagItem`

**Output JSON :**
```json
{
  "total": 142,
  "shown": 10,
  "offset": 0,
  "truncated": false,
  "documents": [{
    "uno": "newsml.afp.com.20260316T202634Z.doc-a3jc2qq",
    "title": "TOPSHOT-FBL-ENG-PR-BRENTFORD-WOLVES",
    "caption": "Brentford's Italian defender #33 Michael Kayode...",
    "creditLine": "ADRIAN DENNIS / AFP",
    "creator": "ADRIAN DENNIS",
    "country": "GBR",
    "city": "London",
    "published": "2026-03-16T22:11:26Z",
    "urgency": 3,
    "class": "picture",
    "aspectRatios": ["afparatio:horizontal"],
    "advisory": "RESTRICTED TO EDITORIAL USE...",
    "renditions": {
      "thumbnail": { "href": "https://...", "width": 320,  "height": 213 },
      "preview":   { "href": "https://...", "width": 1200, "height": 800 },
      "highdef":   { "href": "https://...", "width": 3429, "height": 2286 }
    }
  }]
}
```

**Output Markdown :**
```markdown
*Showing 10 of 142 results (offset: 0).*

## TOPSHOT-FBL-ENG-PR-BRENTFORD-WOLVES
*UNO: newsml... | picture | ADRIAN DENNIS / AFP | London, GBR | 2026-03-16*

![Brentford's Italian defender...](https://...thumbnail.jpg)

[Preview 1200px](https://...) | [HighDef 3429px](https://...)

> RESTRICTED TO EDITORIAL USE...
```

**Output CSV :**
`uno, title, caption, creditLine, published, class, thumbnail_href`

---

### `afp_get_media`

Récupère un document media complet par UNO. Optionnellement, fetche l'image et la retourne en base64 pour analyse Claude (vision MCP).

**Paramètres :**

```typescript
{
  uno: z.string(),
  embed: z.boolean().optional(),   // défaut false
  rendition: z.enum(['thumbnail', 'preview', 'highdef']).optional(),  // défaut 'preview'
}
```

**Type de retour (mise à jour de `types.ts`) :**

```typescript
export interface ImageContent {
  type: 'image';
  data: string;       // base64
  mimeType: string;
}

export type AnyContent = TextContent | ImageContent;

// ToolSuccess mis à jour — rétrocompatible car TextContent[] est un sous-type de AnyContent[]
export interface ToolSuccess {
  content: AnyContent[];
}

// ToolResult reste inchangé dans sa forme, ToolSuccess étant mis à jour
export type ToolResult = ToolSuccess | ToolError;
```

Les fonctions existantes (`formatDocumentOutput`, `truncateIfNeeded`) retournent `TextContent[]` — assignable à `AnyContent[]` sans modification, TypeScript covariant accepte le sous-type.

**Comportement sans embed :**
- Retourne `{ content: [TextContent] }` avec toutes les métadonnées + toutes les renditions + caption complète + advisory

**Comportement avec `embed: true` :**

1. Récupère le document via `apicore.get(uno)`
2. Appelle `extractRenditions(doc.bagItem)` pour obtenir les renditions
3. Sélectionne la rendition demandée (`rendition`, défaut `preview`) ; si absente, tente `preview` → `thumbnail` dans cet ordre
4. **Guard SVG (class `graphic`)** : si la URL se termine par `.svg` ou que le `type` AFP vaut `'Graphic'`, ne pas tenter l'embed → retourner `textContent('Warning: SVG graphics cannot be embedded for vision. Use the rendition URL directly.')` avec les métadonnées
5. **Guard taille** : si `sizeInBytes` de la rendition sélectionnée > 5 000 000, downgrade vers `thumbnail`. Si le thumbnail lui-même > 5 000 000 (cas rare), procéder quand même (le downgrade n'est appliqué qu'une fois)
6. **Guard vidéo (class `video`)** : l'embed vidéo brut est impossible. Utilise la rendition `thumbnail` (poster frame) + ajoute une note dans le `TextContent` : `'Note: video embed — showing thumbnail/poster frame only.'`
7. `fetch(url)` → `ArrayBuffer` → `Buffer.from(arrayBuffer)` → `.toString('base64')`
8. **Détermination du MIME type** (dans l'ordre de priorité) :
   - Champ `type` de la rendition AFP : `'Photo'` → `'image/jpeg'`, `'Graphic'` → `'image/png'`
   - Extension de l'URL : `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, `.webp` → `image/webp`, `.gif` → `image/gif`, `.svg` → `image/svg+xml`
   - Fallback : `image/jpeg`
9. **Si le fetch échoue** : retourner `{ content: [metadataTextContent, textContent('Warning: image embed failed: <error.message>')] }` — pas de `isError: true` (warning non-bloquant)
10. **Si le fetch réussit** : retourner `{ content: [metadataTextContent, { type: 'image', data: base64, mimeType }] }`

**Note sur les URLs AFP :** Les `href` dans `bagItem[].medias` sont des URLs signées (token embarqué). Accessibles directement via `fetch()` sans header d'auth supplémentaire.

---

## `extractRenditions()` — Algorithme complet

```typescript
// src/utils/format-media.ts

// Mapping role AFP → clé normalisée (utilise m.role, pas m.rendition)
export const MEDIA_RENDITION_ROLE_MAP: Record<string, keyof MediaRenditions> = {
  'Thumbnail':  'thumbnail',
  'Preview':    'preview',    // 1200px, prioritaire pour preview
  'Preview_B':  'preview',    // fallback preview (1800px) si Preview absent
  'Preview_W':  'preview',    // fallback preview (1800px) si Preview absent
  'HighDef':    'highdef',
};

export function extractRenditions(bagItem: unknown[]): MediaRenditions {
  if (!Array.isArray(bagItem) || bagItem.length === 0) return {};
  const medias: any[] = (bagItem[0] as any)?.medias ?? [];
  const result: MediaRenditions = {};

  for (const m of medias) {
    const key = MEDIA_RENDITION_ROLE_MAP[m.role as string];
    if (!key) continue;
    // Ne pas écraser une rendition déjà assignée (Preview prioritaire sur Preview_B/W)
    if (result[key]) continue;
    result[key] = {
      href: m.href,
      width: m.width,
      height: m.height,
      sizeInBytes: m.sizeInBytes,
    };
  }

  return result;
}
```

---

## `formatMediaDocumentsAsJson()` — Signature et truncation

```typescript
// src/utils/format-media.ts

export function formatMediaDocumentsAsJson(
  docs: AFPMediaDocument[],
  meta: Record<string, unknown> = {},
): { content: TextContent; truncated: boolean } {
  // Utilise truncateToLimit identique aux outils existants
  const { text, count, truncated } = truncateToLimit(
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
```

---

## Correction de `afp_search_articles`

### Changement dans le handler (`search-articles.ts`)

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

### Presets et interface `PresetOverrides` dans `shared.ts`

**Merge order (important) :** le handler construit la requête comme suit :
```typescript
let request = { query, size, sortOrder, startAt: offset, ...facetFilters };
if (preset) request = { ...request, ...SEARCH_PRESETS[preset] };
```
Le preset écrase les clés de `facetFilters` quand il les redéfinit — comportement intentionnel conservé. Les presets `agenda` et `previsions` redéfinissent `genreid` en inclusion, ce qui écrase `GENRE_EXCLUSIONS` ; c'est intentionnel.

```typescript
// Interface mise à jour
interface PresetOverrides {
  class?: string[];       // remplace product
  lang?: string[];
  slug?: string[];
  dateFrom?: string;
  size?: number;
  genreid?: Record<string, string[]> | string[];
}

// Presets mis à jour
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

Note : `class: ['text']` dans les presets est redondant avec le filtre de base, mais le rend explicite et évite une régression si le filtre de base est modifié ultérieurement.

---

## Architecture — Fichiers

### Nouveaux fichiers

```
src/tools/search-media.ts     # afpSearchMediaTool
src/tools/get-media.ts        # afpGetMediaTool
src/utils/format-media.ts     # extractRenditions(), formatMediaDocument(),
                              # formatMediaDocumentsAsJson(), formatMediaDocumentsAsCsv()
```

### Modifications

| Fichier | Changement |
|---------|-----------|
| `src/utils/types.ts` | + `AFPMediaDocument`, `MediaRendition`, `MediaRenditions`, `ImageContent`, `AnyContent`; update `ToolSuccess.content` à `AnyContent[]`; `ToolResult` inchangé (rédérivé automatiquement) |
| `src/tools/shared.ts` | + `mediaClassEnum`, `renditionEnum`; update `PresetOverrides` (remplace `product` par `class`); update `SEARCH_PRESETS` |
| `src/tools/search-articles.ts` | `product: ['news', 'factcheck']` → `class: ['text']` |
| `src/tools/index.ts` | + register `afpSearchMediaTool`, `afpGetMediaTool` |
| `src/definitions.ts` | + export `afpSearchMediaTool`, `afpGetMediaTool` |
| `CLAUDE.md` | + docs `afp_search_media`, `afp_get_media`; update note sur `afp_search_articles` |

---

## Types TypeScript

```typescript
// src/utils/types.ts (additions/modifications)

export interface MediaRendition {
  href: string;
  width: number;
  height: number;
  sizeInBytes?: number;
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

// ToolSuccess — TextContent[] reste assignable à AnyContent[] (covariant)
export interface ToolSuccess {
  content: AnyContent[];
}
```

---

## Gestion d'erreurs et cas limites

| Cas | Comportement |
|-----|-------------|
| Aucun résultat | `textContent('No results found.')` |
| `bagItem` absent ou vide | Document retourné sans renditions (objet `renditions: {}`) |
| Rendition absente | Omise silencieusement |
| `Preview` absent, `Preview_B`/`Preview_W` présents | `Preview_B` ou `Preview_W` utilisé comme `preview` (premier trouvé) |
| UNO introuvable | `toolError` standard |
| Fetch image échoue (`embed: true`) | `{ content: [metadataText, textContent('Warning: image embed failed: ...')] }` sans `isError` |
| Rendition sélectionnée > 5 MB | Downgrade automatique vers `thumbnail` (une seule fois, pas de re-check) |
| Vidéo + `embed: true` | Retourne poster frame (`thumbnail`) + note dans `TextContent` |
| Graphic SVG + `embed: true` | Warning non-bloquant, pas d'embed ; retourne URL directe dans le `TextContent` |
| MIME inconnu | Fallback `image/jpeg` |
| `facets.class` fourni | Erreur de validation Zod (reservedFacetKeys guard) |
| Classe non disponible dans l'abonnement | Erreur API → `formatErrorMessage` standard |

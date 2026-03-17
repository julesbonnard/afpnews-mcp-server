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

Media classes: picture (photo), video, graphic (infographic/SVG), videography (video journalism).

Args:
  - uno: AFP document UNO (e.g. newsml.afp.com.20260316T202634Z.doc-a3jc2qq)
  - embed: When true, fetches the image and returns it as a base64 MCP image block that Claude can see and analyse visually. Default: false.
  - rendition: Size to embed — 'thumbnail' (320px), 'preview' (1200px, default), 'highdef' (~3400px).
               Files > 5 MB are automatically downgraded to thumbnail.
               Videos and videography always use thumbnail (poster frame). SVG graphics cannot be embedded.

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
        const bytes = new Uint8Array(await response.arrayBuffer());
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) {
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        }
        imageData = btoa(chunks.join(''));
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

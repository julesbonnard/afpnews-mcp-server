import { z } from 'zod';
import type { ApiCore, AfpDocument } from 'afpnews-api';
import { textContent, toolError } from '../utils/format.js';
import { extractRenditions } from '../utils/format-media.js';
import type { MediaRendition, MediaRenditions } from '../utils/types.js';
import { inferMimeType, selectRenditionForEmbed, isSvgRendition, embedRendition } from '../utils/embed-media.js';
import { renditionEnum, formatErrorMessage } from './shared.js';

// Re-exported for testing (moved to utils/embed-media.ts for reuse by search-media.ts)
export { inferMimeType, selectRenditionForEmbed };

const inputSchema = z.object({
  uno: z.string().describe('AFP document UNO identifier (e.g. newsml.afp.com.20260316T202634Z.doc-a3jc2qq)'),
  embed: z.boolean().optional().describe('When true, fetches the image and returns it as base64 for Claude vision analysis. Default: false.'),
  rendition: renditionEnum.optional().describe("Rendition size to embed: 'squared120' (~120px, lightest, square crop), 'quicklook' (~245px, lightest full-frame), 'thumbnail' (320px), 'mockup' (~512px), 'preview' (1200px, default), 'highdef' (~3400px)"),
});

type GetMediaInput = z.infer<typeof inputSchema>;

function formatFullMediaText(doc: AfpDocument, renditions: MediaRenditions, note?: string): string {
  const country = doc.country.name ?? doc.country.id;
  const lines: string[] = [];
  if (doc.title) lines.push(`## ${doc.title}`);
  lines.push(`**UNO:** ${doc.uno}`);
  lines.push(`**Class:** ${doc.class}`);
  if (doc.creditLine) lines.push(`**Credit:** ${doc.creditLine}`);
  if (doc.creator)    lines.push(`**Creator:** ${doc.creator}`);
  lines.push(`**Published:** ${doc.published.toISOString()}`);
  if (country || doc.city) lines.push(`**Location:** ${[doc.city, country].filter(Boolean).join(', ')}`);
  lines.push(`**Urgency:** ${doc.urgency}`);
  if (doc.aspectRatios?.length) lines.push(`**Aspect:** ${doc.aspectRatios.join(', ')}`);

  // Le caption d'une photo/graphique vit sur le media (bagItem), pas sur le document.
  const caption = doc.medias[0]?.caption ?? doc.caption;
  if (caption) lines.push(`\n${caption}`);
  if (doc.advisory) lines.push(`\n> ${doc.advisory}`);

  lines.push('\n**Renditions:**');
  const { squared120, quicklook, thumbnail, mockup, preview, highdef } = renditions;
  if (squared120) lines.push(`- squared120: ${squared120.href} (${squared120.width}×${squared120.height})`);
  if (quicklook)  lines.push(`- quicklook: ${quicklook.href} (${quicklook.width}×${quicklook.height})`);
  if (thumbnail)  lines.push(`- thumbnail: ${thumbnail.href} (${thumbnail.width}×${thumbnail.height})`);
  if (mockup)     lines.push(`- mockup: ${mockup.href} (${mockup.width}×${mockup.height})`);
  if (preview)    lines.push(`- preview: ${preview.href} (${preview.width}×${preview.height})`);
  if (highdef)    lines.push(`- highdef: ${highdef.href} (${highdef.width}×${highdef.height})`);

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
  - rendition: Size to embed — 'squared120' (~120px, square crop, lightest), 'quicklook' (~245px, lightest full-frame), 'thumbnail' (320px), 'mockup' (~512px), 'preview' (1200px, default), 'highdef' (~3400px).
               Files > 5 MB are automatically downgraded to a lighter rendition.
               Videos and videography always use thumbnail (poster frame). SVG graphics cannot be embedded.

Returns:
  - Without embed: full metadata + all rendition URLs
  - With embed: metadata + MCP image block (Claude can analyse the image)`,
  inputSchema,
  handler: async (
    apicore: Pick<ApiCore, 'get'>,
    { uno, embed = false, rendition: requestedRendition = 'preview' }: GetMediaInput,
  ) => {
    try {
      const doc = await apicore.get(uno, { parse: true });

      const renditions = extractRenditions(doc.medias[0]?.renditions);
      const metadataText = textContent(formatFullMediaText(doc, renditions));

      if (!embed) {
        return { content: [metadataText] };
      }

      // Guard: SVG graphics (URL ends with .svg OR AFP type field is 'Graphic')
      const allRenditions = Object.values(renditions).filter(Boolean) as MediaRendition[];
      if (doc.class === 'graphic' && allRenditions.some(isSvgRendition)) {
        return {
          content: [
            metadataText,
            textContent('Warning: SVG graphics cannot be embedded for vision. Use the rendition URL directly.'),
          ],
        };
      }

      // Guard: video → use thumbnail as poster frame
      let renditionKey: keyof MediaRenditions = requestedRendition;
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

      const embedded = await embedRendition(chosen);
      if (!embedded.ok) {
        return {
          content: [
            metadataText,
            textContent(`Warning: image embed failed: ${embedded.error}`),
          ],
        };
      }

      const metaWithNote = note
        ? textContent(formatFullMediaText(doc, renditions, note))
        : metadataText;

      return { content: [metaWithNote, embedded.image] };
    } catch (error) {
      return toolError(formatErrorMessage('retrieving AFP media document', error, 'Check the UNO identifier and try again.'));
    }
  },
};

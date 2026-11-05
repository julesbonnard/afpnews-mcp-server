import { z } from 'zod';
import type { ApiCore, AfpDocument } from 'afpnews-api';
import { textContent, toolError } from '../utils/format.js';
import { extractRenditions } from '../utils/format-media.js';
import type { MediaRendition, MediaRenditions } from '../utils/types.js';
import { inferMimeType, selectRenditionForEmbed, isSvgRendition, embedRendition } from '../utils/embed-media.js';
import { renditionEnum, formatErrorMessage } from './shared.js';

const inputSchema = z.object({
  uno: z.string().describe('AFP document UNO identifier'),
  embed: z.boolean().optional().describe('Embed the image for vision. Default false.'),
  rendition: renditionEnum.optional().describe("Rendition to embed (default quicklook ~245px; squared120 ~120px square crop, thumbnail 320px, mockup ~512px, preview 1200px, highdef ~3400px). Go higher only when detail is needed."),
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

  if (doc.caption) lines.push(`\n${doc.caption}`);
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
  description: `Retrieve an AFP media document (photo, video, graphic, videography) by UNO: metadata and all rendition URLs, optionally with the image embedded for vision. Files over 5 MB fall back to a lighter rendition; videos always embed their poster frame; SVG graphics cannot be embedded.`,
  inputSchema,
  handler: async (
    apicore: Pick<ApiCore, 'get'>,
    { uno, embed = false, rendition: requestedRendition = 'quicklook' }: GetMediaInput,
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

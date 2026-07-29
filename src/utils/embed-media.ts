import type { MediaRendition, MediaRenditions, ImageContent } from './types.js';

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
  requested: keyof MediaRenditions,
): MediaRendition | undefined {
  const SIZE_LIMIT = 5_000_000;

  const get = (key: keyof MediaRenditions): MediaRendition | undefined => renditions[key];

  // Try requested rendition, then fallback chain (largest usable → lightest)
  const candidate = get(requested) ?? get('preview') ?? get('thumbnail') ?? get('quicklook') ?? get('squared120');
  if (!candidate) return undefined;

  // Downgrade if over size limit (only once)
  if ((candidate.sizeInBytes ?? 0) > SIZE_LIMIT) {
    return get('thumbnail') ?? get('quicklook') ?? get('squared120') ?? candidate; // proceed with candidate if no lighter rendition
  }

  return candidate;
}

// SVG graphics (URL ends with .svg OR AFP type field is 'Graphic') cannot be embedded for vision.
export function isSvgRendition(r: MediaRendition): boolean {
  return r.href.split('?')[0].endsWith('.svg') || r.afpType === 'Graphic';
}

export async function embedRendition(
  rendition: MediaRendition,
): Promise<{ ok: true; image: ImageContent } | { ok: false; error: string }> {
  try {
    const response = await fetch(rendition.href);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    }
    const data = btoa(chunks.join(''));
    // MIME priority: AFP type field → URL extension → HTTP Content-Type → fallback
    let mimeType = inferMimeType(rendition.afpType, rendition.href);
    const ct = response.headers.get('content-type');
    if (ct && ct.startsWith('image/')) mimeType = ct.split(';')[0].trim();
    return { ok: true, image: { type: 'image', data, mimeType } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    return { ok: false, error: message };
  }
}

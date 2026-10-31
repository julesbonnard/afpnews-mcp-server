import { describe, it, expect, mock } from 'bun:test';
import { afpListFacetsTool } from '../tools/list-facets.js';

describe('afpListFacetsTool', () => {
  it('returns no-results message when list is empty', async () => {
    const apicore = { list: mock().mockResolvedValue({ keywords: [] }) };

    const result = await afpListFacetsTool.handler(apicore, { facet: 'slug' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).toContain('No facet values found');
  });

  it('applies AFP text defaults with explicit lang outside preset', async () => {
    const apicore = { list: mock().mockResolvedValue({ keywords: [{ name: 'economy', count: 42 }] }) };

    await afpListFacetsTool.handler(apicore, { facet: 'slug', lang: 'en' });

    const [, params] = apicore.list.mock.calls[0]!;
    expect(params).toEqual({ class: ['text'], provider: ['afp'], langs: ['en'], size: 10 });
  });

  it.each([
    ['json', 'json' as const],
    ['csv', 'csv' as const],
    ['markdown (default)', undefined],
  ])('adds a truncation hint in %s output when the facet list is too large', async (_label, format) => {
    const keywords = Array.from({ length: 3000 }, (_, i) => ({ name: `topic-${i}-${'x'.repeat(30)}`, count: i + 1 }));
    const apicore = { list: mock().mockResolvedValue({ keywords }) };

    const result = await afpListFacetsTool.handler(apicore, { facet: 'slug', ...(format ? { format } : {}) });

    expect(result.content.length).toBeGreaterThan(1);
    expect(result.content[1]!.text).toContain('Response truncated');
  });
});

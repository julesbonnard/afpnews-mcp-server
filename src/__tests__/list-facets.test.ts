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
    expect(params).toEqual({ class: ['text'], provider: ['afp', 'أ ف ب'], langs: ['en'], size: 10 });
  });

  it('lists events with their id and name in a single request', async () => {
    const apicore = {
      list: mock().mockResolvedValue({
        keywords: [
          { name: "#IZT27 : Invasion russe de l'Ukraine", count: 168 },
          { name: '#PRT40 : Élections législatives', count: 135 },
          { name: '#PRT40 : Legislative elections', count: 11 },
        ],
      }),
    };

    const result = await afpListFacetsTool.handler(apicore, { facet: 'event', format: 'csv' });

    expect(apicore.list).toHaveBeenCalledTimes(1);
    expect(apicore.list.mock.calls[0]![0]).toBe('afpentity.event.keyword');
    expect(result.content[0]!.text).toBe(
      "name,label,count\nafpevent:IZT27,Invasion russe de l'Ukraine,168\nafpevent:PRT40,Élections législatives,146",
    );
  });

  it('fetches more label rows than requested so merged event counts are complete', async () => {
    const apicore = {
      list: mock().mockResolvedValue({
        keywords: [
          { name: '#PRT40 : Israel votes in legislative elections', count: 1502 },
          { name: '#IUQ01 : Yemen war', count: 925 },
          { name: '#IUQ01 : Guerre du Yémen', count: 804 },
          { name: '#PRT40 : Élections législatives en Israël', count: 254 },
        ],
      }),
    };

    const result = await afpListFacetsTool.handler(apicore, { facet: 'event', size: 1, format: 'json' });

    expect(apicore.list.mock.calls[0]![1]).toMatchObject({ size: 5 });
    expect(JSON.parse(result.content[0]!.text)).toEqual([
      { name: 'afpevent:PRT40', label: 'Israel votes in legislative elections', count: 1756 },
    ]);
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

import { describe, expect, it } from 'bun:test';
import {
  AFP_DEFINITIONS,
  TOOL_DEFINITIONS,
  PROMPT_DEFINITIONS,
  RESOURCE_DEFINITIONS,
} from '../definitions.js';

// `./definitions` is the package's public, framework-agnostic export (documented in README.md,
// consumed externally e.g. by afpnews-deck's aiTools.ts). Nothing else in this repo imports it,
// so nothing else would notice a shape regression here — this is the only safety net.

describe('AFP_DEFINITIONS', () => {
  it('re-exports the same tools/prompts/resources collections', () => {
    expect(AFP_DEFINITIONS.tools).toBe(TOOL_DEFINITIONS);
    expect(AFP_DEFINITIONS.prompts).toBe(PROMPT_DEFINITIONS);
    expect(AFP_DEFINITIONS.resources).toBe(RESOURCE_DEFINITIONS);
  });
});

describe('TOOL_DEFINITIONS', () => {
  it('exposes exactly the expected tool names', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).slice().sort()).toEqual(
      [
        'afp_search_articles',
        'afp_get_article',
        'afp_find_similar',
        'afp_list_facets',
        'afp_search_media',
        'afp_get_media',
      ].slice().sort(),
    );
  });

  it('gives each tool the documented shape (name, title, description, inputSchema, inputJsonSchema, handler)', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.title).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema.safeParse).toBe('function');
      expect(tool.inputJsonSchema).toBeTypeOf('object');
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('derives inputJsonSchema from inputSchema via z.toJSONSchema (not hand-maintained)', () => {
    const getArticle = TOOL_DEFINITIONS.find((t) => t.name === 'afp_get_article');
    expect(getArticle?.inputJsonSchema).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({ uno: expect.anything() }),
    });
  });
});

describe('PROMPT_DEFINITIONS', () => {
  it('exposes exactly the expected prompt names', () => {
    expect(PROMPT_DEFINITIONS.map((p) => p.name).slice().sort()).toEqual(
      ['daily-briefing', 'comprehensive-analysis', 'factcheck', 'country-news'].slice().sort(),
    );
  });

  it('gives each prompt the documented shape (name, title, description, argsSchema, handler)', () => {
    for (const prompt of PROMPT_DEFINITIONS) {
      expect(typeof prompt.name).toBe('string');
      expect(typeof prompt.title).toBe('string');
      expect(typeof prompt.description).toBe('string');
      expect(typeof prompt.handler).toBe('function');
    }
  });
});

describe('RESOURCE_DEFINITIONS', () => {
  it('exposes the topics resource with the documented shape (name, uri, description, mimeType, handler)', () => {
    expect(RESOURCE_DEFINITIONS).toHaveLength(1);
    const [topics] = RESOURCE_DEFINITIONS;
    expect(topics.name).toBe('topics');
    expect(topics.uri).toBe('afp://topics');
    expect(typeof topics.description).toBe('string');
    expect(typeof topics.mimeType).toBe('string');
    expect(typeof topics.handler).toBe('function');
  });
});

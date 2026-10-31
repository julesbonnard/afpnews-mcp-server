import { describe, expect, it } from 'bun:test';
import { AFP_DEFINITIONS, PROMPT_DEFINITIONS, RESOURCE_DEFINITIONS } from '../definitions.js';

// `./definitions` is the package's public, framework-agnostic export. Nothing else in this
// repo imports it, so this is the only safety net against a shape regression.
// Tool metadata isn't part of it — see create-server.test.ts for the equivalent safety net,
// via the real protocol (listTools()).

describe('AFP_DEFINITIONS', () => {
  it('re-exports the same prompts/resources collections', () => {
    expect(AFP_DEFINITIONS.prompts).toBe(PROMPT_DEFINITIONS);
    expect(AFP_DEFINITIONS.resources).toBe(RESOURCE_DEFINITIONS);
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

import { TOPICS } from '../utils/topics.js';

export const topicsResource = {
  name: 'topics',
  uri: 'afp://topics',
  description: 'AFP Stories topic catalog — available sections by language (fr, en, de, pt, es, ar) with their identifiers',
  mimeType: 'application/json',
  handler: async () => {
    return {
      contents: [{
        uri: 'afp://topics',
        text: JSON.stringify(TOPICS, null, 2),
      }],
    };
  },
};

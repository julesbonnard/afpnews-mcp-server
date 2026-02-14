import { ServerContext } from './context.js';
import { formatDocument, GENRE_EXCLUSIONS } from './format.js';

export function registerResources({ server, apicore, authenticate }: ServerContext) {
  server.registerResource("breaking",
    "afp://breaking",
    {
      description: "Latest AFP breaking news articles",
      mimeType: "application/json"
    },
    async () => {
      await authenticate();
      const { documents } = await apicore.search({
        product: 'news',
        size: 10,
        sortOrder: 'desc',
        genreid: GENRE_EXCLUSIONS
      } as any);
      return {
        contents: [{
          uri: "afp://breaking",
          text: JSON.stringify(documents.map((doc: any) => formatDocument(doc)), null, 2)
        }]
      };
    }
  );

  server.registerResource("topics",
    "afp://topics",
    {
      description: "Trending AFP topics (most frequent slugs)",
      mimeType: "application/json"
    },
    async () => {
      await authenticate();
      const result = await apicore.list('slug', {}, 20);
      return {
        contents: [{
          uri: "afp://topics",
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );
}

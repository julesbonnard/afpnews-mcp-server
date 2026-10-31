import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { afpSearchMediaTool } from './search-media.js';
import { afpGetMediaTool } from './get-media.js';

const RAW_TOOLS = [
  afpSearchArticlesTool,
  afpGetArticleTool,
  afpFindSimilarTool,
  afpListFacetsTool,
  afpSearchMediaTool,
  afpGetMediaTool,
] as const;

export { RAW_TOOLS };

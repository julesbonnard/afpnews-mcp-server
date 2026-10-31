import { topicsResource } from './topics.js';

export const RESOURCE_DEFINITIONS = [topicsResource] as const;

export type ResourceDefinition = (typeof RESOURCE_DEFINITIONS)[number];

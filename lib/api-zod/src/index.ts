export * from "./generated/api";
export * from "./generated/types";
// Orval names both the path validator and the query TS type GetFeedMediaParams.
// Preserve the existing validator export and expose the query type distinctly.
export { GetFeedMediaParams } from "./generated/api";
export type { GetFeedMediaParams as FeedMediaVersionQuery } from "./generated/types/getFeedMediaParams";

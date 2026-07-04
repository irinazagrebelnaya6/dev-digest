/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract.
   FileCard is also exported so callers (e.g. SmartDiffViewer) can render a
   single file outside the default DiffViewer list ordering. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";

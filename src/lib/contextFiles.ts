export const CONTEXT_FILE_ACCEPT =
  ".pdf,.txt,.md,.markdown,.json,.xml,.html,.htm,image/*,text/*,application/json,application/xml,application/pdf,text/html";

export function isSupportedContextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime.startsWith("image/") ||
    mime === "application/pdf"
  );
}

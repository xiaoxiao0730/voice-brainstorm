// Tiny, dependency-free markdown → safe HTML converter.
//
// Scope: inline markdown that appears in Research results and AI brief blocks
// (bold, italic, inline code, links, line breaks, simple unordered lists,
// `#`/`##` headings). HTML in the source is escaped first, so the output is
// safe to insert via innerHTML.
//
// This is deliberately small — for richer rendering, swap in `marked` +
// DOMPurify behind the same `renderMarkdownToSafeHtml` signature.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(escaped: string): string {
  let s = escaped;
  // Inline code: `code`
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // Links: [text](http(s)://...)  — only safe schemes
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  // Bold: **text** or __text__
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  // Italic: *text* or _text_  (avoid matching inside already-tagged content)
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  // Bare URLs → links
  s = s.replace(
    /(^|[\s(])((?:https?:\/\/)[^\s)<]+)/g,
    (_m, pre, url) =>
      `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  );
  return s;
}

/**
 * Convert markdown to safe HTML. Always escapes raw HTML first.
 * Returns a single HTML string suitable for innerHTML.
 */
export function renderMarkdownToSafeHtml(md: string): string {
  if (!md) return "";
  const escaped = escapeHtml(md);
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let listBuf: string[] | null = null;

  const flushList = () => {
    if (listBuf) {
      out.push(`<ul>${listBuf.join("")}</ul>`);
      listBuf = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const bullet = /^(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      listBuf ??= [];
      listBuf.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }
    flushList();
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      out.push(`<strong>${renderInline(h2[1])}</strong>`);
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      out.push(`<strong>${renderInline(h1[1])}</strong>`);
      continue;
    }
    out.push(renderInline(line));
  }
  flushList();
  // Join paragraphs with <br> so multi-line bodies keep their breaks within
  // the single <p>/<h2> block the brief document renders.
  return out.join("<br>");
}

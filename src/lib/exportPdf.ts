import type { BriefBlock, BriefDoc } from "@/lib/pipeline/types";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeFilename(value: string) {
  return (value || "live-brief").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
}

function blocksFromDoc(doc: BriefDoc) {
  return Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

function bodyHtml(body: string) {
  const lines = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const listItems = lines.filter((line) => /^[-*]\s+/.test(line));
  if (listItems.length === lines.length) {
    return `<ul>${listItems
      .map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`)
      .join("")}</ul>`;
  }

  return lines.map((line) => `<p>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</p>`).join("");
}

function blockHtml(block: BriefBlock) {
  const heading = block.heading?.trim();
  const body = block.body?.trim();
  const headingLevel = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";

  return `
    <section class="block level-${block.level}">
      ${heading ? `<${headingLevel}>${escapeHtml(heading)}</${headingLevel}>` : ""}
      ${body ? bodyHtml(body) : ""}
    </section>
  `;
}

function fallbackHtml(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function printableHtml(doc: BriefDoc, title: string, fallbackText = "") {
  const blocks = blocksFromDoc(doc);
  const content = blocks.length > 0 ? blocks.map(blockHtml).join("") : fallbackHtml(fallbackText);
  const displayTitle = title || "Live Brief";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(displayTitle)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1f1f1f;
      background: #ffffff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12.5pt;
      line-height: 1.55;
    }
    main { max-width: 720px; margin: 0 auto; }
    header { margin-bottom: 28px; padding-bottom: 14px; border-bottom: 1px solid #d8d3ca; }
    .eyebrow { margin: 0 0 8px; color: #777064; font-size: 8.5pt; letter-spacing: 0.16em; text-transform: uppercase; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 24pt; line-height: 1.15; font-weight: 650; }
    h2 { margin: 22px 0 7px; font-size: 16pt; line-height: 1.25; font-weight: 650; }
    h3 { margin: 16px 0 6px; font-size: 12.5pt; line-height: 1.3; font-weight: 650; }
    p { margin: 0 0 9px; white-space: pre-wrap; }
    ul { margin: 0 0 10px 18px; padding: 0; }
    li { margin: 0 0 5px; padding-left: 2px; }
    .block { break-inside: avoid; margin-bottom: 8px; }
    .empty { color: #777064; font-style: italic; }
    @media screen {
      body { background: #efede8; padding: 32px; }
      main { min-height: calc(297mm - 36mm); padding: 18mm; background: #fff; box-shadow: 0 18px 60px rgba(33, 31, 27, 0.14); }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Murmur export</p>
      <h1>${escapeHtml(displayTitle)}</h1>
    </header>
    ${content || `<p class="empty">Nothing to export yet.</p>`}
  </main>
  <script>
    window.addEventListener("load", () => window.setTimeout(() => window.print(), 250));
  </script>
</body>
</html>`;
}

export function exportBriefToPdfPrint(doc: BriefDoc, title: string, fallbackText = "") {
  if (typeof window === "undefined") return;

  const html = printableHtml(doc, title, fallbackText);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, "_blank");

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

  if (!printWindow) {
    throw new Error("PDF export was blocked by the browser. Please allow pop-ups and try again.");
  }

  printWindow.document.title = `${safeFilename(title)}.pdf`;
}

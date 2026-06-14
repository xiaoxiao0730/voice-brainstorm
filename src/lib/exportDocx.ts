import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import type { BriefBlock, BriefDoc } from "@/lib/pipeline/types";

const HEADING_BY_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

function blockParagraphs(block: BriefBlock): Paragraph[] {
  const paras: Paragraph[] = [];
  if (block.heading?.trim()) {
    paras.push(
      new Paragraph({
        heading: HEADING_BY_LEVEL[block.level] ?? HeadingLevel.HEADING_3,
        children: [new TextRun({ text: block.heading, bold: true })],
      }),
    );
  }
  const body = block.body?.trim() ?? "";
  if (body) {
    for (const line of body.split(/\n+/)) {
      paras.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  }
  paras.push(new Paragraph({ children: [new TextRun("")] }));
  return paras;
}

export async function exportBriefToDocx(doc: BriefDoc, title: string) {
  const blocks = Object.values(doc).sort((a, b) =>
    a.orderKey.localeCompare(b.orderKey),
  );

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title || "Live Brief", bold: true })],
    }),
    new Paragraph({ children: [new TextRun("")] }),
    ...blocks.flatMap(blockParagraphs),
  ];

  const wordDoc = new Document({
    creator: "Murmur",
    title,
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(wordDoc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeTitle = (title || "live-brief").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  a.href = url;
  a.download = `${safeTitle || "live-brief"}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

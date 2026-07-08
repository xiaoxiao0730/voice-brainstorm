// ============================================================================
// Live Brief pipeline test — paste this whole block into the browser console
// on the workbench page (http://127.0.0.1:5173/workbench?debug=1).
//
// It feeds a text note through the REAL decideBrief server function the same
// way speech does (split into segments → mini-batch of 2 → decideBrief sees the
// full brief snapshot each time → patches applied), then prints the final
// brief. No microphone, no DB writes — pure pipeline + real LLM.
//
// To test your own note: edit NOTE below, re-paste. To test prompt changes:
// edit decideBrief.functions.ts, RESTART the dev server, re-paste.
// ============================================================================
(async () => {
  // ---- 1. Your test note. Replace with anything you want to test. ----------
  const NOTE = `我想做一个面向独立开发者的 newsletter 工具。核心痛点是现在大家写 newsletter 要么用 Substack 抽成太狠，要么用 Mailchimp 太复杂还贵。我的想法是做一个极简的、按发送量付费的工具。
主要功能我想了三块。第一是写作，要支持 Markdown，最好能直接从 Notion 导入。第二是订阅管理，要能导入已有的邮件列表，还要有简单的分组。第三是数据，至少要看到打开率和点击率。
商业模式上我倾向免费额度加超量付费，比如每月 1000 封免费，超过按千封计价。但这里有个风险，免费额度如果设太高，我的发送成本扛不住，得算清楚单位成本。
技术上我打算用 Resend 做发送，因为它对开发者友好。但 Resend 的送达率我还没验证过，万一进垃圾箱率高这个产品就废了。
竞品方面 Buttondown 跟我想做的很像，已经验证了市场存在。我的差异点主要是 Notion 集成和更激进的免费额度。
下一步我想先做 landing page。不对，应该先做 10 个用户访谈"，收集邮箱，看有多少人感兴趣。`;

  const MODEL = "openai/gpt-4o-mini"; // match the workbench model selector
  const BATCH = 2;                    // mini-batch size (THOUGHT_TURN_CONSTANTS.MAX_SEGMENTS)

  // ---- 2. Imports (real modules from the running app) ----------------------
  const { decideBrief } = await import("/src/lib/orchestrator/decideBrief.functions.ts");
  const { applyBriefPatch } = await import("/src/lib/pipeline/applyBriefPatch.ts");

  // ---- 3. Split the note into segments, the way the transcript buffer would.
  // One sentence ≈ one Azure final ≈ one segment (rough but representative).
  const segments = NOTE.split(/[\n。！？!?]+/).map((s) => s.trim()).filter((s) => s.length > 1);
  console.log(`%c[test] ${segments.length} segments, batched by ${BATCH}`, "color:#0284c7;font-weight:bold");

  // ---- 4. Build the snapshot decideBrief expects (needs real block ids so it
  // can target append_to_block / update_block). -----------------------------
  const SID = "00000000-0000-0000-0000-000000000test";
  let doc = {}; // BriefDoc: id -> block
  const snapshotOf = () =>
    Object.values(doc)
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
      .map((b) => ({
        id: b.id,
        kind: b.level === 2 ? "h2" : "p",
        text: (b.level === 2 ? b.heading : b.body) ?? "",
        locked: b.locked,
      }));

  // ---- 5. Feed mini-batches through decideBrief, applying patches. ----------
  const recentTurns = []; // rolling window of prior fragments (oldest→newest)
  let batchNo = 0;
  for (let i = 0; i < segments.length; i += BATCH) {
    batchNo++;
    const fragment = segments.slice(i, i + BATCH).join(" ");
    const snapshot = snapshotOf();
    let decision;
    try {
      decision = await decideBrief({
        data: {
          thoughtTurn: { combinedText: fragment, boundaryReason: "hard_limit" },
          recentTurns: recentTurns.slice(),
          snapshot,
          model: MODEL,
        },
      });
    } catch (e) {
      console.error(`[test] batch ${batchNo} decideBrief FAILED:`, e?.message);
      recentTurns.push(fragment);
      if (recentTurns.length > 5) recentTurns.shift();
      continue;
    }
    const patches = decision.patches ?? [];
    console.groupCollapsed(
      `%c[batch ${batchNo}] "${fragment.slice(0, 40)}…" → ${patches.length} patch(es)`,
      "color:#7c3aed",
    );
    console.log("rationale:", decision.rationale || "(none)");
    for (const p of patches) {
      console.log(`  • ${p.action}`, p.blockId ? `→ ${p.blockId.slice(0, 8)}` : "(new)", "|", (p.heading || p.bodyMarkdown || "").slice(0, 60));
      const { doc: nextDoc, result } = applyBriefPatch(doc, p, { sessionId: SID });
      if (result.ok) doc = nextDoc;
      else console.warn(`    ✗ apply skipped: ${result.reason}`);
    }
    if (decision.proposeResearch?.query) console.log("  research?:", decision.proposeResearch.query);
    console.groupEnd();
    recentTurns.push(fragment);
    if (recentTurns.length > 5) recentTurns.shift();
  }

  // ---- 6. Print the final brief as the user would see it. -------------------
  const ordered = Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  const rendered = ordered
    .map((b) => (b.level === 2 ? `\n## ${b.heading}` : b.body))
    .filter(Boolean)
    .join("\n");
  console.log("%c================ FINAL BRIEF ================", "color:#16a34a;font-weight:bold");
  console.log(rendered);
  console.log(
    `%c[test] ${ordered.length} blocks · ${ordered.filter((b) => b.level === 2).length} headings · ${ordered.filter((b) => b.level === 3).length} body blocks`,
    "color:#16a34a",
  );
  // Expose for inspection.
  window.__briefTest = { doc, ordered, rendered };
  console.log("[test] full doc on window.__briefTest");
})();

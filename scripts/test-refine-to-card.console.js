// ============================================================================
// refineToCard test — paste into the browser console on the workbench page
// (http://127.0.0.1:5173/workbench?debug=1).
//
// Feeds several raw "spoken" transcripts through the REAL refineToCard server
// function and prints input → {title, body, kind}. Use this to iterate the
// refinement prompt WITHOUT talking. Edit CASES, re-paste. After editing
// refineToCard.functions.ts, RESTART the dev server, then re-paste.
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o-mini";
  const { refineToCard } = await import("/src/lib/orchestrator/refineToCard.functions.ts");

  // Raw transcripts as Azure might hand them over (with fillers / repeats).
  const CASES = [
    "嗯，我觉得这个登录流程有点复杂，有点复杂",
    "那个，要不要先做一个 landing page 验证一下需求",
    "我决定就用 Resend 来发邮件吧",
    "就是呢，用户停止输入之后，AI 帮他生成一张卡片",
    "呃，竞品 Buttondown 跟我想做的其实挺像的",
    "下一步我想先收集一些用户的邮箱",
    "嗯…这个，我不太确定免费额度应该设多少",
    "好",
  ];

  console.log("%c=== refineToCard ===", "color:#0284c7;font-weight:bold");
  for (const raw of CASES) {
    try {
      const r = await refineToCard({ data: { rawTranscript: raw, model: MODEL } });
      const shrink = `${raw.length}→${(r.title || "").length}`;
      console.log(
        `%c[${r.kind}]%c "${raw}"  →  "${r.title}"${r.body ? `  | body: ${r.body}` : ""}  (${shrink}字)`,
        "color:#7c3aed;font-weight:bold",
        "color:inherit",
      );
    } catch (e) {
      console.error("FAILED:", raw, e?.message);
    }
  }
  console.log("%c=== done ===", "color:#16a34a;font-weight:bold");
})();

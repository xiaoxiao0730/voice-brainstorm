// ============================================================================
// Artifact Scaffolding V2 console test — paste into the browser console on
// /workbench?debug=1. It calls the real planArtifactTurnV2 server function.
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o-mini";
  const { planArtifactTurnV2, EMPTY_ARTIFACT_SESSION_STATE_V2 } = await import(
    "/src/lib/orchestrator/artifactScaffoldV2.functions.ts"
  );

  let state = EMPTY_ARTIFACT_SESSION_STATE_V2;
  const checks = [];
  const turns = [
    {
      name: "1. scaffold generation",
      text:
        "我最近想做一个 AI 学习产品，但是我还没有想清楚具体方向。我觉得现在很多 AI tutor 都是在回答问题，但是学生还是不会真正学习。我希望这个产品可以帮助学生真正掌握概念和思维。你觉得我应该怎么做？",
    },
    {
      name: "2. target user / need update",
      text:
        "主要是大学生，他们已经会用 ChatGPT 获取答案，但很多时候只是完成作业，没有应用知识。",
    },
    {
      name: "3. semantic extraction",
      text: "嗯，我觉得，嗯，主要是理解一个新的概念吧，然后，呃，做一些比较。",
    },
    { name: "4. add section", text: "加一个竞品分析 section。" },
    { name: "5. noisy fallback", text: "weather Joshua attendance island temperature venue" },
  ];

  const hasChineseLikeSection = (artifact) =>
    (artifact?.sections ?? []).some((section) => /用户|需求|功能|市场|验证|研究|目标|人群/.test(section.title));
  const allBodiesAreBullets = (artifact) =>
    (artifact?.sections ?? []).every(
      (section) => section.bodyBullets.length === 0 || section.bodyBullets.every((bullet) => !/^嗯|呃|主要是/.test(bullet)),
    );

  console.log("%c=== Artifact Scaffold V2 ===", "color:#2563eb;font-weight:bold");
  for (const [index, turn] of turns.entries()) {
    const contract = await planArtifactTurnV2({
      data: {
        userTurn: turn.text,
        currentState: state,
        recentTurns: turns.slice(0, index).map((item) => item.text),
        canvasSnapshot: "",
        model: MODEL,
      },
    });
    state = contract.nextState;

    console.group(turn.name);
    console.log("input:", turn.text);
    console.log("route:", contract.route);
    console.log("mode:", state.mode);
    console.log("artifact:", state.artifact);
    console.log("canvasOps:", contract.canvasOps);
    console.log("voiceReply:", contract.voiceReply);
    console.log("diagnostics:", contract.diagnostics);
    console.groupEnd();

    if (index === 0) {
      checks.push(["scaffoldGeneration", contract.route === "scaffold_generation"]);
      checks.push(["usedLLMForScaffold", contract.diagnostics.usedLLM && !contract.diagnostics.fallback]);
      checks.push(["generatedArtifact", Boolean(state.artifact?.title && state.artifact.sections.length >= 3)]);
      checks.push(["sectionsLookSemantic", hasChineseLikeSection(state.artifact)]);
      checks.push(["renderArtifactOp", contract.canvasOps.some((op) => op.action === "render_artifact")]);
    }
    if (index === 1) {
      checks.push(["sectionUpdate", contract.route === "section_update"]);
      checks.push(["bulletsNotRawTranscript", allBodiesAreBullets(state.artifact)]);
      checks.push(["hasCollegeOrChatGPT", JSON.stringify(state.artifact).includes("大学生") || JSON.stringify(state.artifact).includes("ChatGPT")]);
    }
    if (index === 2) {
      checks.push(["semanticExtractionUpdate", contract.route === "section_update"]);
      checks.push(["removesFillers", !JSON.stringify(state.artifact).includes("嗯") && !JSON.stringify(state.artifact).includes("呃")]);
      checks.push(["capturesConceptNeed", /概念|比较/.test(JSON.stringify(state.artifact))]);
    }
    if (index === 3) {
      checks.push(["addSection", contract.route === "add_section"]);
      checks.push(["activeNewSection", state.artifact?.sections.some((section) => section.title.includes("竞品") && section.id === state.activeSectionId)]);
    }
    if (index === 4) {
      checks.push(["noisyFallback", contract.diagnostics.fallback]);
      checks.push(["noCanvasWriteOnFallback", contract.canvasOps.length === 0]);
    }
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

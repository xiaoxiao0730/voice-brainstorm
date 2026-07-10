// ============================================================================
// Semantic Pipeline V0 thin end-to-end test — paste into the browser console on
// /workbench.
//
// This starts from raw-ish user turns and intentionally skips a dedicated
// Input Understanding layer. Today, the raw turn is passed directly as the
// thoughtSegment, so this test covers:
// user turn -> State Updater -> Context Builder -> Orchestrator.
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o";
  const {
    createEmptyThinkingStateV0,
    formatThinkingStateV0,
    planThinkingStatePatchV0,
  } = await import("/src/lib/agent/thinkingState.functions.ts");
  const { buildOrchestratorContextV0 } = await import(
    "/src/lib/orchestrator/orchestratorContextV0.functions.ts"
  );
  const { planOrchestratorTurnV0, formatOrchestratorOutputV0 } = await import(
    "/src/lib/orchestrator/orchestratorV0.functions.ts"
  );
  const { createSession } = await import("/src/lib/session.functions.ts");

  const session = await createSession({ data: { title: "Semantic Pipeline V0 Demo" } });
  const checks = [];
  let state = createEmptyThinkingStateV0(session.id);
  let canvasArtifactView = null;
  const recentTurns = [];

  const artifactToPlainText = (artifact) => {
    if (!artifact) return "";
    const lines = [`Focus: ${artifact.title}`];
    for (const [index, section] of artifact.sections.entries()) {
      lines.push(`${index + 1}. ${section.heading}`);
      for (const bullet of section.bullets ?? []) lines.push(`   - ${bullet}`);
    }
    return lines.join("\n");
  };

  const hasSection = (output, pattern) =>
    output.canvasArtifactView?.sections.some((section) => pattern.test(section.heading));
  const section = (output, id) => output.canvasArtifactView?.sections.find((item) => item.id === id);
  const stateText = () => JSON.stringify(state);
  const outputText = (output) => JSON.stringify(output);

  const runTurn = async ({ label, userTurn, assertions }) => {
    console.group(label);
    console.log("userTurn:", userTurn);

    const plannedState = await planThinkingStatePatchV0({
      data: {
        sessionId: session.id,
        turnId: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        thoughtSegment: userTurn,
        currentState: state,
        model: MODEL,
      },
    });
    state = plannedState.nextState;
    recentTurns.push(`User: ${userTurn}`);

    const context = buildOrchestratorContextV0({
      thinkingState: state,
      recentTurns: recentTurns.slice(-8),
      uploadedContext: [],
      canvasSnapshot: {
        plainText: artifactToPlainText(canvasArtifactView),
        nodes: [],
        edges: [],
      },
    });

    const output = await planOrchestratorTurnV0({ data: { context, model: MODEL } });
    if (output.canvasArtifactView) canvasArtifactView = output.canvasArtifactView;
    recentTurns.push(`AI: ${output.voiceResponse}`);

    console.log("state patch:", plannedState.patch);
    console.log("state diagnostics:", plannedState.diagnostics);
    console.log(formatThinkingStateV0(state));
    console.log(formatOrchestratorOutputV0(output));
    console.log(output);
    console.groupEnd();

    checks.push([`${label}: state patch applied`, plannedState.applied]);
    for (const [name, predicate] of assertions) {
      checks.push([`${label}: ${name}`, Boolean(predicate(output, plannedState))]);
    }
    return output;
  };

  await runTurn({
    label: "Turn 1 Product Direction",
    userTurn:
      "我最近想做一个 AI 学习产品，但是我还没有想清楚具体方向。我觉得现在很多 AI tutor 都是在回答问题，但是学生还是不会真正学习。我希望这个产品可以帮助学生真正掌握概念和思维。你觉得我应该怎么做？",
    assertions: [
      ["state captures AI learning product", () => /AI|学习|产品|tutor/i.test(stateText())],
      ["orchestrator proposes before rendering", (output) => output.nextAction === "ask_user" && output.canvasArtifactView === null],
      ["voice mentions PRD", (output) => /PRD|prd/.test(output.voiceResponse)],
      ["voice mentions four PRD areas", (output) => /目标用户/.test(output.voiceResponse) && /用户需求/.test(output.voiceResponse) && /核心功能/.test(output.voiceResponse) && /市场调研/.test(output.voiceResponse)],
    ],
  });

  await runTurn({
    label: "Turn 2 Accept Scaffold",
    userTurn: "好的，就这么写。",
    assertions: [
      ["orchestrator updates canvas", (output) => output.nextAction === "update_canvas"],
      ["creates PRD artifact", (output) => output.canvasArtifactView?.artifactType === "prd"],
      ["has target user", (output) => hasSection(output, /目标用户/)],
      ["has user need", (output) => hasSection(output, /用户需求/)],
      ["has core features", (output) => hasSection(output, /核心功能/)],
      ["has market research", (output) => hasSection(output, /市场调研/)],
      ["target user active", (output) => output.canvasArtifactView?.activeSectionId === "target_user"],
    ],
  });

  await runTurn({
    label: "Turn 3 Target User",
    userTurn:
      "我觉得主要是大学生。他们已经可以使用 ChatGPT 获取答案，但是很多时候只是完成作业，没有应用知识。",
    assertions: [
      ["state captures college students", () => /大学生/.test(stateText())],
      ["state captures AI answers or homework", () => /ChatGPT|答案|作业|应用/.test(stateText())],
      ["orchestrator updates canvas", (output) => output.nextAction === "update_canvas"],
      ["target user filled", (output) => section(output, "target_user")?.status === "filled"],
      ["artifact captures students", (output) => /大学生/.test(outputText(output))],
      ["artifact captures AI answers", (output) => /AI|ChatGPT|答案/.test(outputText(output))],
      ["user need active", (output) => output.canvasArtifactView?.activeSectionId === "user_need" || section(output, "user_need")?.status === "active"],
      ["voice reframes to understanding", (output) => /从答案走向理解|获取不到答案/.test(output.voiceResponse)],
    ],
  });

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

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
  const { renderArtifactViewToIdeaCanvasV0, formatIdeaCanvasStateV0 } = await import(
    "/src/lib/orchestrator/artifactViewRendererV0.ts"
  );
  const { createSession } = await import("/src/lib/session.functions.ts");

  const session = await createSession({ data: { title: "Semantic Pipeline V0 Demo" } });
  const checks = [];
  let state = createEmptyThinkingStateV0(session.id);
  let canvasArtifactView = null;
  let ideaCanvas = { nodes: [], edges: [] };
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
  const canvasText = () => JSON.stringify(ideaCanvas);

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
    if (output.canvasArtifactView) {
      canvasArtifactView = output.canvasArtifactView;
      ideaCanvas = renderArtifactViewToIdeaCanvasV0(output.canvasArtifactView, ideaCanvas);
    }
    recentTurns.push(`AI: ${output.voiceResponse}`);

    console.log("state patch:", plannedState.patch);
    console.log("state diagnostics:", plannedState.diagnostics);
    console.log(formatThinkingStateV0(state));
    console.log(formatOrchestratorOutputV0(output));
    console.log(output);
    console.group("Rendered IdeaCanvasState V0");
    console.log(formatIdeaCanvasStateV0(ideaCanvas));
    console.log(ideaCanvas);
    console.groupEnd();
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
      ["orchestrator leads with recommendation", (output) => /建议|先|应该|我会|可以/.test(output.voiceResponse) && !/你觉得|你认为/.test(output.voiceResponse)],
      ["orchestrator creates scaffold", (output) => output.nextAction === "update_canvas" && output.canvasArtifactView?.artifactType === "prd"],
      ["scaffold covers product planning areas", (output) => /目标|用户|受众/.test(outputText(output)) && /需求|问题/.test(outputText(output)) && /功能|方案|机制|解决/.test(outputText(output)) && /市场|调研|风险|研究/.test(outputText(output))],
      ["renderer creates canvas nodes", () => ideaCanvas.nodes.length > 0],
      ["renderer creates canvas edges", () => ideaCanvas.edges.length > 0],
      ["renderer uses xmind locked nodes", () => ideaCanvas.nodes.length > 0 && ideaCanvas.nodes.every((node) => node.data.layoutMode === "xmind" && node.data.locked === true)],
    ],
  });

  await runTurn({
    label: "Turn 2 Accept Scaffold",
    userTurn: "好的，就这么写。",
    assertions: [
      ["does not lose artifact", (output) => output.canvasArtifactView?.artifactType === "prd" || canvasArtifactView?.artifactType === "prd"],
      ["keeps product planning sections", () => /目标|用户|受众/.test(JSON.stringify(canvasArtifactView)) && /需求|问题/.test(JSON.stringify(canvasArtifactView))],
      ["voice stays directive", (output) => !/你觉得|你认为|是否/.test(output.voiceResponse)],
      ["keeps rendered canvas", () => ideaCanvas.nodes.length > 0 && ideaCanvas.edges.length > 0],
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
      ["rendered canvas captures students", () => /大学生/.test(canvasText())],
      ["rendered canvas keeps details in body", () => ideaCanvas.nodes.some((node) => /大学生|ChatGPT|答案|作业|应用/.test(node.data.body ?? ""))],
    ],
  });

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

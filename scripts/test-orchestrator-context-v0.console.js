// ============================================================================
// Orchestrator Context V0 console test — paste into the browser console on
// /workbench. Tests deterministic context building from ThinkingStateV0.
// ============================================================================
(async () => {
  const { buildOrchestratorContextV0, formatOrchestratorContextV0 } = await import(
    "/src/lib/orchestrator/orchestratorContextV0.functions.ts"
  );
  const { createSession } = await import("/src/lib/session.functions.ts");

  const now = () => new Date().toISOString();
  const session = await createSession({ data: { title: "Orchestrator Context V0 Test" } });
  const checks = [];
  const node = (id, type, content, extra = {}) => ({
    id,
    type,
    content,
    confidence: 0.85,
    source: "user",
    updatedAt: now(),
    ...extra,
  });
  const edge = (source, target, relation) => ({
    id: `${source}-${relation}-${target}`,
    source,
    target,
    relation,
  });

  const state = {
    sessionId: session.id,
    graph: {
      nodes: [
        node("ai_learning_assistant", "thought", "做一个 AI 学习助手"),
        node("target_students", "fact", "目标用户是大学生", { parentId: "ai_learning_assistant" }),
        node("ai_answers_homework", "fact", "大学生已用 AI 获取作业答案", { parentId: "target_students" }),
        node("answer_to_understanding", "thought", "帮助学生从答案走向理解", { parentId: "ai_learning_assistant" }),
        node("how_to_force_thinking", "question", "如何让学生先思考再看答案", { parentId: "answer_to_understanding" }),
        node("interview_followup", "thought", "用 AI 追问模拟面试官", { parentId: "answer_to_understanding" }),
        node("low_patience_risk", "question", "学生没耐心可能直接卸载"),
      ],
      edges: [
        edge("ai_learning_assistant", "target_students", "includes"),
        edge("target_students", "ai_answers_homework", "includes"),
        edge("ai_learning_assistant", "answer_to_understanding", "includes"),
        edge("answer_to_understanding", "how_to_force_thinking", "leads_to"),
        edge("answer_to_understanding", "interview_followup", "includes"),
        edge("interview_followup", "low_patience_risk", "contradicts"),
      ],
    },
    control: {
      goal: "明确 AI 学习助手的 PRD 方向",
      focusNodeId: "answer_to_understanding",
      unresolvedQuestionIds: ["how_to_force_thinking", "low_patience_risk"],
      artifactProgress: { target_user: "filled", user_need: "active" },
      interactionStage: "clarify",
    },
    meta: { version: 1, lastTurnId: "turn_1", updatedAt: now() },
  };

  const context = buildOrchestratorContextV0({
    thinkingState: state,
    recentTurns: [
      "我想做一个 AI 学习产品。",
      "目标用户主要是大学生，他们已经会用 ChatGPT 写作业。",
    ],
    uploadedContext: [
      {
        id: "interview_notes",
        title: "学生访谈笔记",
        summary: "学生会用 AI 找答案，但缺少解释、追问和迁移练习。",
        relevantSnippets: ["多数学生说自己知道答案，但不知道为什么。"],
        sourceType: "file",
      },
    ],
    canvasSnapshot: {
      plainText: "Focus: AI 学习助手\n目标用户: 大学生\n用户需求: 从答案走向理解",
      nodes: [
        { id: "canvas_focus", title: "AI 学习助手", body: "", kind: "focus", selected: false },
        { id: "canvas_user", title: "目标用户", body: "大学生，已使用 AI 获取答案", kind: "idea", selected: false },
      ],
      edges: [{ source: "canvas_focus", target: "canvas_user", label: "includes" }],
    },
  });

  console.group("Orchestrator Context V0");
  console.log(context);
  console.log(formatOrchestratorContextV0(context));
  console.groupEnd();

  const includes = (value, pattern) => pattern.test(JSON.stringify(value));
  checks.push(["has state summary", /Goal:|Focus:|Key claims:/.test(context.stateSummary)]);
  checks.push(["summary keeps goal", context.semanticSummary.goal === "明确 AI 学习助手的 PRD 方向"]);
  checks.push(["focus is answer_to_understanding", context.focus.nodeId === "answer_to_understanding"]);
  checks.push(["focus related includes question", includes(context.focus.relatedNodes, /如何让学生先思考/)]);
  checks.push(["outline has root", context.graph.outline.some((item) => item.id === "ai_learning_assistant")]);
  checks.push(["unresolved questions preserved", context.unresolvedQuestions.length === 2]);
  checks.push(["uploaded context included", includes(context.uploadedContext, /学生访谈笔记/)]);
  checks.push(["canvas snapshot included", includes(context.canvasSnapshot, /从答案走向理解/)]);
  checks.push(["recent turns included", context.recentTurns.length === 2]);
  checks.push(["diagnostics count nodes", context.diagnostics.nodeCount === state.graph.nodes.length]);

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

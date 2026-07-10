// ============================================================================
// Orchestrator V0 demo-flow assertion test — paste into the browser console on
// /workbench. Tests high-level voice + artifact planning in isolation.
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o";
  const { buildOrchestratorContextV0 } = await import(
    "/src/lib/orchestrator/orchestratorContextV0.functions.ts"
  );
  const { planOrchestratorTurnV0, formatOrchestratorOutputV0 } = await import(
    "/src/lib/orchestrator/orchestratorV0.functions.ts"
  );
  const { createSession } = await import("/src/lib/session.functions.ts");

  const now = () => new Date().toISOString();
  const session = await createSession({ data: { title: "Orchestrator V0 Demo Flow" } });
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
  const makeState = ({ nodes, edges = [], focusNodeId = null, stage = "explore", goal = "" }) => ({
    sessionId: session.id,
    graph: { nodes, edges },
    control: {
      goal,
      focusNodeId,
      unresolvedQuestionIds: nodes.filter((item) => item.type === "question").map((item) => item.id),
      artifactProgress: {},
      interactionStage: stage,
    },
    meta: { version: 1, lastTurnId: "fixture", updatedAt: now() },
  });
  const section = (output, id) => output.canvasArtifactView?.sections.find((item) => item.id === id);
  const outputText = (output) => JSON.stringify(output);
  const hasSectionHeading = (output, pattern) => output.canvasArtifactView?.sections.some((item) => pattern.test(item.heading));

  const runCase = async ({ name, context, assertions }) => {
    const output = await planOrchestratorTurnV0({ data: { context, model: MODEL } });
    console.group(name);
    console.log(formatOrchestratorOutputV0(output));
    console.log(output);
    console.groupEnd();
    for (const [label, predicate] of assertions) {
      checks.push([`${name}: ${label}`, Boolean(predicate(output))]);
    }
    return output;
  };

  await runCase({
    name: "Case 1 Propose PRD",
    context: buildOrchestratorContextV0({
      thinkingState: makeState({
        goal: "明确 AI 学习产品的方向",
        focusNodeId: "ai_learning_product",
        stage: "explore",
        nodes: [
          node("ai_learning_product", "thought", "想做 AI 学习产品"),
          node("ai_tutors_answer_questions", "fact", "很多 AI tutor 主要回答问题", { parentId: "ai_learning_product" }),
          node("students_do_not_learn", "question", "学生仍然没有真正学习", { parentId: "ai_learning_product" }),
          node("master_concepts_thinking", "thought", "帮助学生掌握概念和思维", { parentId: "ai_learning_product" }),
        ],
        edges: [
          edge("ai_learning_product", "ai_tutors_answer_questions", "includes"),
          edge("ai_learning_product", "students_do_not_learn", "includes"),
          edge("ai_learning_product", "master_concepts_thinking", "includes"),
        ],
      }),
      recentTurns: [
        "User: 我最近想做一个 AI 学习产品，但是还没有想清楚具体方向。AI tutor 都是在回答问题，但学生还是不会真正学习。我希望帮助学生真正掌握概念和思维。你觉得我应该怎么做？",
      ],
      uploadedContext: [],
      canvasSnapshot: { plainText: "", nodes: [], edges: [] },
    }),
    assertions: [
      ["asks/proposes instead of rendering", (output) => output.nextAction === "ask_user" && output.canvasArtifactView === null],
      ["mentions PRD", (output) => /PRD|prd/.test(output.voiceResponse)],
      ["mentions target/user need/core/market", (output) => /目标用户/.test(output.voiceResponse) && /用户需求/.test(output.voiceResponse) && /核心功能/.test(output.voiceResponse) && /市场调研/.test(output.voiceResponse)],
    ],
  });

  await runCase({
    name: "Case 2 Accepted Scaffold",
    context: buildOrchestratorContextV0({
      thinkingState: makeState({
        goal: "写一个 AI 学习助手 PRD",
        focusNodeId: "accepted_prd",
        stage: "draft",
        nodes: [
          node("ai_learning_product", "thought", "做 AI 学习助手"),
          node("accepted_prd", "decision", "用户同意写轻量 PRD", { parentId: "ai_learning_product" }),
        ],
        edges: [edge("ai_learning_product", "accepted_prd", "leads_to")],
      }),
      recentTurns: ["AI: 可以先把它写成一个 PRD，包含目标用户、用户需求、核心功能和市场调研。我们先从这个结构开始吗？", "User: 好的，就这么写。"],
      uploadedContext: [],
      canvasSnapshot: { plainText: "", nodes: [], edges: [] },
    }),
    assertions: [
      ["updates canvas", (output) => output.nextAction === "update_canvas"],
      ["creates artifact view", (output) => output.canvasArtifactView?.artifactType === "prd"],
      ["has target user section", (output) => hasSectionHeading(output, /目标用户/)],
      ["has user need section", (output) => hasSectionHeading(output, /用户需求/)],
      ["has core feature section", (output) => hasSectionHeading(output, /核心功能/)],
      ["has market research section", (output) => hasSectionHeading(output, /市场调研/)],
      ["target user active", (output) => output.canvasArtifactView?.activeSectionId === "target_user"],
      ["voice guides target user", (output) => /谁在学习|什么方式学习|遇到.*困难|哪一类学生/.test(output.voiceResponse)],
    ],
  });

  await runCase({
    name: "Case 3 Target User Filled",
    context: buildOrchestratorContextV0({
      thinkingState: makeState({
        goal: "写一个 AI 学习助手 PRD",
        focusNodeId: "target_students",
        stage: "clarify",
        nodes: [
          node("ai_learning_product", "thought", "做 AI 学习助手"),
          node("target_students", "fact", "目标用户是大学生", { parentId: "ai_learning_product" }),
          node("ai_answers_homework", "fact", "大学生已使用 ChatGPT 获取答案完成作业", { parentId: "target_students" }),
          node("no_knowledge_application", "question", "学生没有应用知识", { parentId: "target_students" }),
        ],
        edges: [
          edge("ai_learning_product", "target_students", "includes"),
          edge("target_students", "ai_answers_homework", "includes"),
          edge("target_students", "no_knowledge_application", "includes"),
        ],
      }),
      recentTurns: [
        "User: 我觉得主要是大学生。他们已经可以使用 ChatGPT 获取答案，但是很多时候只是完成作业，没有应用知识。",
      ],
      uploadedContext: [],
      canvasSnapshot: {
        plainText: "Focus: AI 学习助手\n1. 目标用户\n2. 用户需求\n3. 核心功能\n4. 市场调研",
        nodes: [],
        edges: [],
      },
    }),
    assertions: [
      ["updates canvas", (output) => output.nextAction === "update_canvas"],
      ["target user filled", (output) => section(output, "target_user")?.status === "filled"],
      ["target user bullet captures students", (output) => /大学生/.test(outputText(output))],
      ["target user bullet captures AI answers", (output) => /AI|ChatGPT|答案/.test(outputText(output))],
      ["user need active", (output) => output.canvasArtifactView?.activeSectionId === "user_need" || section(output, "user_need")?.status === "active"],
      ["voice reframes answer to understanding", (output) => /获取不到答案|从答案走向理解/.test(output.voiceResponse)],
      ["voice gives user need options", (output) => /理解.*概念|知识漏洞|练习.*应用|复盘/.test(output.voiceResponse)],
    ],
  });

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

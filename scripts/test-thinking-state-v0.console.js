// ============================================================================
// Thinking State V0 assertion matrix — paste into the browser console on
// /workbench. Tests state transition quality in isolation.
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o";
  const {
    createEmptyThinkingStateV0,
    applyStatePatch,
    formatThinkingStateV0,
    planThinkingStatePatchV0,
  } = await import("/src/lib/agent/thinkingState.functions.ts");
  const { createSession } = await import("/src/lib/session.functions.ts");

  const now = () => new Date().toISOString();
  const session = await createSession({ data: { title: "Thinking State V0 Assertion Matrix" } });
  const checks = [];

  const normalizeContent = (value) => String(value ?? "").replace(/[\s，。,.!?！？'“”‘’]/g, "").toLowerCase();
  const stateText = (state) => JSON.stringify(state);
  const node = (id, type, content, extra = {}) => ({
    id,
    type,
    content,
    confidence: 0.8,
    source: "agent",
    updatedAt: now(),
    ...extra,
  });
  const edge = (source, target, relation) => ({
    id: `${source}-${relation}-${target}`,
    source,
    target,
    relation,
  });
  const makeState = (suffix, { nodes = [], edges = [], focusNodeId = null, stage = "explore", goal = "" }) => ({
    sessionId: session.id,
    graph: { nodes, edges },
    control: {
      goal,
      focusNodeId,
      unresolvedQuestionIds: nodes.filter((item) => item.type === "question").map((item) => item.id),
      artifactProgress: {},
      interactionStage: stage,
    },
    meta: { version: 0, lastTurnId: null, updatedAt: now(), testCase: suffix },
  });
  const hasNode = (state, pattern) => state.graph.nodes.some((item) => pattern.test(item.content));
  const hasEdge = (state, relation) => state.graph.edges.some((item) => item.relation === relation);
  const findByContent = (state, pattern) => state.graph.nodes.find((item) => pattern.test(item.content));
  const noContent = (state, pattern) => !state.graph.nodes.some((item) => pattern.test(item.content));
  const isNodeOrDescendant = (state, nodeId, ancestorId) => {
    if (!nodeId) return false;
    if (nodeId === ancestorId) return true;
    let current = state.graph.nodes.find((item) => item.id === nodeId);
    const seen = new Set();
    while (current?.parentId && !seen.has(current.id)) {
      if (current.parentId === ancestorId) return true;
      seen.add(current.id);
      current = state.graph.nodes.find((item) => item.id === current.parentId);
    }
    return false;
  };
  const noDuplicateContent = (state) => {
    const seen = new Set();
    for (const item of state.graph.nodes) {
      const key = normalizeContent(item.content);
      if (!key) continue;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  };

  const runCase = async ({ name, currentState, input, assertions }) => {
    const planned = await planThinkingStatePatchV0({
      data: {
        sessionId: session.id,
        turnId: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        thoughtSegment: input,
        currentState,
        model: MODEL,
      },
    });
    const nextState = planned.nextState;
    console.group(name);
    console.log("input:", input);
    console.log("patch:", planned.patch);
    console.log("diagnostics:", planned.diagnostics);
    console.log(formatThinkingStateV0(nextState));
    console.groupEnd();
    checks.push([`${name}: applied`, planned.applied]);
    checks.push([`${name}: no duplicate content`, noDuplicateContent(nextState)]);
    checks.push([
      `${name}: no dangling edges`,
      nextState.graph.edges.every((item) =>
        nextState.graph.nodes.some((n) => n.id === item.source) &&
        nextState.graph.nodes.some((n) => n.id === item.target),
      ),
    ]);
    for (const [label, predicate] of assertions) {
      checks.push([`${name}: ${label}`, Boolean(predicate(nextState, planned))]);
    }
    return nextState;
  };

  // Smoke test: pure patch engine.
  const base = createEmptyThinkingStateV0(session.id);
  const manual = applyStatePatch(base, {
    patchId: "manual-patch-1",
    turnId: "manual-turn-1",
    baseVersion: 0,
    idempotencyKey: "manual-turn-1:v0",
    ops: [
      { op: "add_node", node: node("ai_learning_product", "thought", "用户想做 AI 学习产品", { source: "user" }) },
      {
        op: "add_node",
        node: node("students_do_not_learn", "question", "学生没有真正学习", {
          source: "user",
          parentId: "ai_learning_product",
        }),
      },
      { op: "add_edge", edge: edge("ai_learning_product", "students_do_not_learn", "includes") },
      { op: "set_focus", nodeId: "students_do_not_learn" },
      { op: "update_control", changes: { goal: "明确 AI 学习产品方向", interactionStage: "clarify" } },
    ],
  });
  console.group("0. Pure patch apply");
  console.log("applied:", manual.applied, manual.reason);
  console.log(formatThinkingStateV0(manual.state));
  console.groupEnd();
  checks.push(["Pure patch: applied", manual.applied]);
  checks.push(["Pure patch: parentId set", manual.state.graph.nodes.find((item) => item.id === "students_do_not_learn")?.parentId === "ai_learning_product"]);

  await runCase({
    name: "Case 1 Standard Progressive Line",
    currentState: makeState("case1", {
      focusNodeId: "sec_1",
      stage: "explore",
      nodes: [
        node("sec_1", "fact", "待明确目标用户", { confidence: 0.2 }),
        node("sec_2", "thought", "待明确用户需求", { confidence: 0.2 }),
      ],
      edges: [edge("sec_1", "sec_2", "leads_to")],
    }),
    input: "我觉得主要是大学生。他们已经可以使用 ChatGPT 获取答案，但是很多时候只是完成作业，没有应用知识。",
    assertions: [
      ["updates sec_1", (state, planned) => planned.patch.ops.some((op) => op.op === "update_node" && op.nodeId === "sec_1")],
      ["captures college students", (state) => /大学生/.test(state.graph.nodes.find((item) => item.id === "sec_1")?.content ?? "")],
      ["captures homework/no application", (state) => /作业|应用|答案/.test(stateText(state))],
      ["moves focus to user-need area", (state) => isNodeOrDescendant(state, state.control.focusNodeId, "sec_2")],
    ],
  });

  await runCase({
    name: "Case 2 Focus Jumping",
    currentState: makeState("case2", {
      focusNodeId: "sec_1",
      stage: "explore",
      nodes: [node("sec_1", "fact", "待明确目标用户", { confidence: 0.2 })],
    }),
    input: "等等，目标用户先放放。我突然有个绝妙的功能点子：可以用 AI 模拟面试官，通过追问来逼学生思考，而不是直接给答案！",
    assertions: [
      ["creates feature/mechanism node", (state) => hasNode(state, /模拟面试官|追问|逼学生思考|引导思考/)],
      ["focus jumps away from sec_1", (state) => state.control.focusNodeId && state.control.focusNodeId !== "sec_1"],
      ["focused node is feature", (state) => /模拟面试官|追问|思考/.test(state.graph.nodes.find((item) => item.id === state.control.focusNodeId)?.content ?? "")],
    ],
  });

  await runCase({
    name: "Case 3 State Overwriting",
    currentState: makeState("case3", {
      focusNodeId: "sec_1",
      stage: "clarify",
      nodes: [node("sec_1", "fact", "目标用户是大学生", { source: "user" })],
    }),
    input: "不对，我仔细想了下，大学生自驱力太差了。这个产品应该面向那些职场新人，他们为了晋升更有动力去真正掌握思维。",
    assertions: [
      ["updates existing sec_1", (state, planned) => planned.patch.ops.some((op) => op.op === "update_node" && op.nodeId === "sec_1")],
      ["sec_1 becomes workplace newcomers", (state) => /职场新人|晋升/.test(state.graph.nodes.find((item) => item.id === "sec_1")?.content ?? "")],
      ["does not add duplicate target node", (state) => state.graph.nodes.filter((item) => /大学生|职场新人|目标用户/.test(item.content)).length <= 1],
    ],
  });

  await runCase({
    name: "Case 4 Argument Mining",
    currentState: makeState("case4", {
      focusNodeId: "node_root",
      stage: "explore",
      nodes: [node("node_root", "thought", "做一个 AI 学习助手", { source: "user" })],
    }),
    input: "我希望它能帮学生掌握思维。但是这里有个大冲突，现在的学生太懒了，如果查不到标准答案，他们可能根本没耐心用这个产品，直接就卸载了。",
    assertions: [
      ["captures thinking mastery", (state) => hasNode(state, /掌握思维|训练思维/)],
      ["captures patience risk", (state) => hasNode(state, /没耐心|卸载|标准答案/)],
      ["has includes edge", (state) => hasEdge(state, "includes")],
      ["has contradicts edge", (state) => hasEdge(state, "contradicts")],
    ],
  });

  await runCase({
    name: "Case 5 Noise Filtering",
    currentState: makeState("case5", {
      focusNodeId: "feature_focus",
      stage: "clarify",
      nodes: [node("feature_focus", "thought", "待明确核心功能", { confidence: 0.2 })],
    }),
    input: "呃……让我想想啊，就是那个……核心功能的话。其实我刚才点的那杯咖啡太甜了。哦对了，功能方面，我觉得第一步一定要有‘错题复盘’。",
    assertions: [
      ["captures error review", (state) => hasNode(state, /错题复盘/)],
      ["filters coffee", (state) => noContent(state, /咖啡|太甜/)],
      ["filters filler", (state) => noContent(state, /呃|让我想想|就是那个/)],
    ],
  });

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

// ============================================================================
// Semantic Pipeline V0 playground — paste into the browser console on
// /workbench.
//
// Exposes window.semanticPipelineV0 so you can run one turn at a time:
//   await semanticPipelineV0.turn("我想做一个 AI 学习产品...")
//   await semanticPipelineV0.prompt()
//   semanticPipelineV0.status()
//   semanticPipelineV0.reset()
//
// Covers:
// raw-ish user turn -> State Updater -> Context Builder -> Orchestrator
// and prints thinking state changes, canvas artifact output, and voice output.
// ============================================================================
(async () => {
  const DEFAULT_MODEL = "openai/gpt-4o";
  const {
    createEmptyThinkingStateV0,
    formatThinkingStateV0,
    planThinkingStatePatchV0,
  } = await import("/src/lib/agent/thinkingState.functions.ts");
  const {
    buildOrchestratorContextV0,
    formatOrchestratorContextV0,
  } = await import("/src/lib/orchestrator/orchestratorContextV0.functions.ts");
  const {
    planOrchestratorTurnV0,
    formatOrchestratorOutputV0,
  } = await import("/src/lib/orchestrator/orchestratorV0.functions.ts");
  const {
    renderArtifactViewToIdeaCanvasV0,
    formatIdeaCanvasStateV0,
  } = await import("/src/lib/orchestrator/artifactViewRendererV0.ts");
  const { createSession } = await import("/src/lib/session.functions.ts");

  const session = await createSession({ data: { title: "Semantic Pipeline V0 Playground" } });
  const state = {
    model: DEFAULT_MODEL,
    thinkingState: createEmptyThinkingStateV0(session.id),
    canvasArtifactView: null,
    ideaCanvas: { nodes: [], edges: [] },
    recentTurns: [],
    uploadedContext: [],
    turnIndex: 0,
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalize = (value) => String(value ?? "").replace(/[\s，。,.!?！？'“”‘’]/g, "").toLowerCase();

  const artifactToPlainText = (artifact) => {
    if (!artifact) return "";
    const lines = [`Focus: ${artifact.title}`];
    for (const [index, section] of artifact.sections.entries()) {
      lines.push(`${index + 1}. ${section.heading} [${section.status}]`);
      for (const bullet of section.bullets ?? []) lines.push(`   - ${bullet}`);
    }
    return lines.join("\n");
  };

  const diffThinkingState = (before, after) => {
    const beforeNodes = new Map(before.graph.nodes.map((node) => [node.id, node]));
    const afterNodes = new Map(after.graph.nodes.map((node) => [node.id, node]));
    const beforeEdges = new Map(before.graph.edges.map((edge) => [edge.id, edge]));
    const afterEdges = new Map(after.graph.edges.map((edge) => [edge.id, edge]));

    const addedNodes = [];
    const updatedNodes = [];
    for (const node of afterNodes.values()) {
      const prev = beforeNodes.get(node.id);
      if (!prev) {
        addedNodes.push(node);
      } else if (normalize(prev.content) !== normalize(node.content) || prev.type !== node.type || prev.parentId !== node.parentId) {
        updatedNodes.push({ id: node.id, before: prev.content, after: node.content, type: node.type, parentId: node.parentId ?? "" });
      }
    }
    const removedNodes = [...beforeNodes.values()].filter((node) => !afterNodes.has(node.id));
    const addedEdges = [...afterEdges.values()].filter((edge) => !beforeEdges.has(edge.id));
    const removedEdges = [...beforeEdges.values()].filter((edge) => !afterEdges.has(edge.id));

    return {
      control: {
        stageBefore: before.control.interactionStage,
        stageAfter: after.control.interactionStage,
        focusBefore: before.control.focusNodeId,
        focusAfter: after.control.focusNodeId,
        goalBefore: before.control.goal,
        goalAfter: after.control.goal,
      },
      addedNodes,
      updatedNodes,
      removedNodes,
      addedEdges,
      removedEdges,
    };
  };

  const printDiff = (diff) => {
    console.table([diff.control]);
    if (diff.addedNodes.length) {
      console.group("Added nodes");
      console.table(diff.addedNodes.map((node) => ({ id: node.id, type: node.type, content: node.content, parentId: node.parentId ?? "" })));
      console.groupEnd();
    }
    if (diff.updatedNodes.length) {
      console.group("Updated nodes");
      console.table(diff.updatedNodes);
      console.groupEnd();
    }
    if (diff.addedEdges.length) {
      console.group("Added edges");
      console.table(diff.addedEdges.map((edge) => ({ source: edge.source, relation: edge.relation, target: edge.target })));
      console.groupEnd();
    }
    if (diff.removedNodes.length || diff.removedEdges.length) {
      console.log("Removed:", { nodes: diff.removedNodes, edges: diff.removedEdges });
    }
  };

  const makeContext = () => buildOrchestratorContextV0({
    thinkingState: state.thinkingState,
    recentTurns: state.recentTurns.slice(-8),
    uploadedContext: state.uploadedContext,
    canvasSnapshot: {
      plainText: artifactToPlainText(state.canvasArtifactView),
      nodes: [],
      edges: [],
    },
  });

  const turn = async (userTurn, options = {}) => {
    const text = String(userTurn ?? "").trim();
    if (!text) throw new Error("semanticPipelineV0.turn requires a non-empty user turn");
    const model = options.model || state.model;
    state.turnIndex += 1;
    const turnId = `playground_turn_${state.turnIndex}`;
    const before = clone(state.thinkingState);

    console.group(`Semantic Pipeline V0 Turn ${state.turnIndex}`);
    console.log("User turn:", text);
    console.log("Model:", model);

    const plannedState = await planThinkingStatePatchV0({
      data: {
        sessionId: session.id,
        turnId,
        thoughtSegment: text,
        currentState: state.thinkingState,
        model,
      },
    });
    state.thinkingState = plannedState.nextState;
    state.recentTurns.push(`User: ${text}`);

    const context = makeContext();
    const output = await planOrchestratorTurnV0({ data: { context, model } });
    if (output.canvasArtifactView) {
      state.canvasArtifactView = output.canvasArtifactView;
      state.ideaCanvas = renderArtifactViewToIdeaCanvasV0(output.canvasArtifactView, state.ideaCanvas);
    }
    state.recentTurns.push(`AI: ${output.voiceResponse}`);

    const diff = diffThinkingState(before, state.thinkingState);

    console.group("1. State Patch");
    console.log("applied:", plannedState.applied);
    console.log("patch:", plannedState.patch);
    console.log("diagnostics:", plannedState.diagnostics);
    printDiff(diff);
    console.groupEnd();

    console.group("2. Thinking State After");
    console.log(formatThinkingStateV0(state.thinkingState));
    console.groupEnd();

    console.group("3. Orchestrator Context Summary");
    console.log(formatOrchestratorContextV0(context));
    console.groupEnd();

    console.group("4. Orchestrator Output");
    console.log(formatOrchestratorOutputV0(output));
    console.log(output);
    console.groupEnd();

    console.group("5. Current Canvas Artifact Plain Text");
    console.log(artifactToPlainText(state.canvasArtifactView) || "(none)");
    console.groupEnd();

    console.group("6. Rendered IdeaCanvasState V0");
    console.log(formatIdeaCanvasStateV0(state.ideaCanvas));
    console.log(state.ideaCanvas);
    console.groupEnd();

    console.groupEnd();

    return {
      sessionId: session.id,
      turnId,
      userTurn: text,
      stateBefore: before,
      stateAfter: state.thinkingState,
      statePatch: plannedState.patch,
      stateDiagnostics: plannedState.diagnostics,
      stateDiff: diff,
      context,
      output,
      canvasArtifactView: state.canvasArtifactView,
      ideaCanvas: state.ideaCanvas,
      canvasPlainText: artifactToPlainText(state.canvasArtifactView),
    };
  };

  const api = {
    async turn(userTurn, options = {}) {
      return turn(userTurn, options);
    },
    async prompt(options = {}) {
      const text = window.prompt("User turn");
      if (!text) return null;
      return turn(text, options);
    },
    status() {
      const context = makeContext();
      console.group("Semantic Pipeline V0 Status");
      console.log("sessionId:", session.id);
      console.log("model:", state.model);
      console.log("turnIndex:", state.turnIndex);
      console.log(formatThinkingStateV0(state.thinkingState));
      console.log("Canvas artifact:", state.canvasArtifactView);
      console.log(artifactToPlainText(state.canvasArtifactView) || "(none)");
      console.log(formatIdeaCanvasStateV0(state.ideaCanvas));
      console.log(formatOrchestratorContextV0(context));
      console.groupEnd();
      return { ...state, sessionId: session.id, context };
    },
    reset() {
      state.thinkingState = createEmptyThinkingStateV0(session.id);
      state.canvasArtifactView = null;
      state.ideaCanvas = { nodes: [], edges: [] };
      state.recentTurns = [];
      state.uploadedContext = [];
      state.turnIndex = 0;
      console.log("semanticPipelineV0 reset");
      return api.status();
    },
    setModel(model) {
      state.model = String(model || DEFAULT_MODEL);
      console.log("semanticPipelineV0 model:", state.model);
    },
    setUploadedContext(items) {
      state.uploadedContext = Array.isArray(items) ? items : [];
      console.log("semanticPipelineV0 uploadedContext items:", state.uploadedContext.length);
    },
    get raw() {
      return state;
    },
  };

  window.semanticPipelineV0 = api;
  console.log("semanticPipelineV0 ready");
  console.log('Try: await semanticPipelineV0.turn("我最近想做一个 AI 学习产品，但是还没有想清楚方向...")');
  console.log("Or:  await semanticPipelineV0.prompt()");
})();

// ============================================================================
// Artifact Scaffolding demo test — paste into the browser console on workbench
// (http://127.0.0.1:5173/workbench?debug=1).
//
// Runs the real planThoughtTurnContract server function without microphone.
// It simulates the AI learning product PRD demo turn by turn and prints
// acceptance checks for artifact mode, section updates, and voice guidance.
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o-mini";
  const { planThoughtTurnContract } = await import(
    "/src/lib/orchestrator/thoughtTurnContract.functions.ts"
  );
  const { createSession } = await import("/src/lib/session.functions.ts");

  const emptyArtifactState = {
    mode: "none",
    artifactType: "prd",
    artifactTitle: "",
    sections: [],
    activeSectionId: "",
  };

  let thinkingState = {
    current_goal: "",
    user_intent: "",
    assumptions: [],
    open_questions: [],
    promising_directions: [],
    decision_points: [],
    last_turn_id: null,
    artifact_state: emptyArtifactState,
  };

  const sessionId =
    new URLSearchParams(window.location.search).get("session") ||
    (await createSession({ data: { title: "Artifact Scaffold Console Test" } })).id;
  const turns = [
    {
      name: "1. 初始 vague product input",
      text:
        "我最近想做一个 AI 学习产品，但是我还没有想清楚具体方向。我觉得现在很多 AI tutor 都是在回答问题，但是学生还是不会真正学习。我希望这个产品可以帮助学生真正掌握概念和思维。你觉得我应该怎么做？",
    },
    { name: "2. 用户确认 scaffold", text: "好的，就这么写。" },
    {
      name: "3. 目标用户补充",
      text:
        "我觉得主要是大学生。他们已经可以使用 ChatGPT 获取答案，但是很多时候只是完成作业，没有应用知识。",
    },
    {
      name: "4. 用户需求补充",
      text:
        "我觉得他们不是没有答案，而是看完答案以后没有真正理解概念，也不知道怎么应用到新的题目里。",
    },
  ];

  const has = (text, snippets) => snippets.every((snippet) => String(text ?? "").includes(snippet));
  const sectionByTitle = (contract, title) =>
    (contract.artifactState?.sections ?? []).find((section) => section.title === title);

  const checks = [];
  console.log("%c=== Artifact Scaffold Demo ===", "color:#7c3aed;font-weight:bold");

  for (const [index, turn] of turns.entries()) {
    const contract = await planThoughtTurnContract({
      data: {
        sessionId,
        turnId: `artifact-demo-${index + 1}`,
        userTurn: turn.text,
        currentThinkingState: thinkingState,
        briefText: "",
        canvasText: "",
        recentTurns: turns.slice(0, index).map((item) => item.text),
        model: MODEL,
      },
    });

    thinkingState = contract.thinkingState;
    const artifact = contract.artifactState;
    console.group(turn.name);
    console.log("input:", turn.text);
    console.log("interactionMode:", contract.interactionMode);
    console.log("artifactState:", artifact);
    console.log("artifactOps:", contract.artifactOps);
    console.log("voiceReplyHint:", contract.voiceReplyHint);
    console.groupEnd();

    if (index === 0) {
      checks.push(["hasArtifactType", artifact.artifactType === "prd"]);
      checks.push(["proposesPRDScaffold", contract.interactionMode === "artifact_proposal"]);
      checks.push(["noCanvasScaffoldOnProposal", contract.artifactOps[0]?.action === "propose_artifact"]);
      checks.push([
        "voiceMentionsFourPRDSections",
        has(contract.voiceReplyHint, ["目标用户", "用户需求", "核心功能", "市场调研"]),
      ]);
    }
    if (index === 1) {
      checks.push(["scaffoldCreatedAfterAcceptance", contract.interactionMode === "artifact_scaffolding"]);
      checks.push(["hasFourSections", artifact.sections.length === 4]);
      checks.push(["activeSectionTargetUser", artifact.activeSectionId === "target_user"]);
    }
    if (index === 2) {
      const targetUser = sectionByTitle(contract, "目标用户");
      checks.push(["updatesExistingSection", contract.artifactOps.some((op) => op.action === "update_section")]);
      checks.push(["targetUserFilled", Boolean(targetUser?.body?.includes("大学生"))]);
      checks.push(["voiceGuidesToUserNeed", has(contract.voiceReplyHint, ["User Need"])]);
      checks.push([
        "avoidsBroadQuestioning",
        !/哪个方向|从哪个方向|想从哪里/.test(contract.voiceReplyHint),
      ]);
    }
    if (index === 3) {
      const userNeed = sectionByTitle(contract, "用户需求");
      checks.push(["userNeedFilled", Boolean(userNeed?.body?.includes("从答案走向理解"))]);
      checks.push(["guidesCoreFeatures", has(contract.voiceReplyHint, ["核心功能"])]);
      checks.push([
        "doesNotExposeCognitiveIntervention",
        !/hidden_tension|current_paradigm|emerging_intuition|reframed_question/.test(
          JSON.stringify(contract),
        ),
      ]);
    }
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([name, ok]) => ({ check: name, pass: Boolean(ok) })));
  console.log(`%c${passed}/${checks.length} checks passed`, passed === checks.length ? "color:#16a34a" : "color:#dc2626");
})();

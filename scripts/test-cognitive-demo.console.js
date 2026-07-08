// ============================================================================
// Cognitive demo golden test V3 Lite — paste this whole block into the browser
// console on the workbench page (http://127.0.0.1:5173/workbench?debug=1).
//
// This test aligns with scripts/demo-script.md:
// Scattered thought -> weak hypothesis -> evidence challenge -> hypothesis
// revision -> evidence confidence -> action outline.
//
// It runs the real server functions:
// 1) structureVoiceToCanvas: uploaded context + short uncertain PM input
// 2) evaluateCognitiveTrajectory: full hypothesis-evolution demo trajectory
//
// No microphone, no real file upload, no DB writes.
//
// Realtime Agent reply testing:
// - If you have run a live Realtime demo in this page, the test reads
//   window.__murmurRealtimeAgentReplies and scores those real replies.
// - If no Realtime replies exist, it falls back to the scripted golden replies.
// - To reset captured Realtime replies before a new run:
//   window.__murmurRealtimeAgentReplies = []
// ============================================================================
(async () => {
  const MODEL = "openai/gpt-4o-mini";
  const BLOCKING_TAGS = new Set([
    "RAW_TRANSCRIPT_LEAK",
    "LOW_FIDELITY",
    "MISSING_S2_REASONING",
    "MISSING_S3_ACTION",
    "PREMATURE_FEATURE_JUMP",
    "FLAT_CARD_LIST",
  ]);

  const uploadedContextSummary = `[Uploaded context summary]
Interview Notes: The PM likes Copilot recap for catching up and remembering what was discussed. She did not complain that the recap was empty or inaccurate. After launch reviews, she still creates a separate OneNote/Loop checklist, copies possible decisions and follow-ups manually, and confirms whether each line is a decision, suggestion, or unresolved question.
Teams Chat: After the launch review, teammates ask: "Was the rollout change actually decided?" and "Did ownership move from Priya to Alex?" Another teammate says the recap mentions the risk item but does not say whether it is assigned or still open.
Planner/Jira: Follow-ups exist, but "Confirm rollout change" has no owner and unconfirmed status. "Risk review follow-up" has owner "Priya?" and needs confirmation. "Share next steps in Teams" is open because the team needs a decision list first.`;

  const step1ScatteredIntent = `Okay...

I thought the opportunity was probably improving recap quality before.

Now I want to think through the opportunity using the materials I uploaded.

I'm not sure anymore. Something feels off.`;

  const rawTranscript = `${uploadedContextSummary}\n\n[User scattered voice input]\n${step1ScatteredIntent}`;

  const turns = [
    step1ScatteredIntent,
    `Maybe the recap just isn't detailed enough.`,
    `Wait...

The interview notes say she actually liked the recap.

She used it to catch up.`,
    `But after every meeting, she still opens OneNote.

She makes a checklist after reading the recap.`,
    `Then she messages teammates asking, "Who's taking this?"`,
    `Can you map what is actually happening after the meeting?`,
    `Wait...

She never actually complained about the recap.

She liked it.`,
    `Oh. The Teams chat also matters.

People were asking, "Was that actually decided?"`,
    `Someone else asked whether ownership had changed.`,
  ];

  const agentReplies = [
    `Recording your current hypothesis.`,
    `Let's test that.`,
    `I found a challenge to that hypothesis: Interview Notes say the participant liked the recap for memory and catch-up.`,
    `Adding that as evidence under the current analysis.`,
    `The evidence points to a gap between remembering the meeting and turning it into accountable follow-up.`,
    `Let me reorganize these observations into the user's workflow.`,
    `I think this is where the friction begins.`,
    `That explains more of what we've observed.`,
    `Now the evidence is pointing in one direction.`,
    `I think we've collected enough evidence. Here's the opportunity I believe the evidence supports.`,
  ];

  const finalArtifact = `Action Outline

Core Insight
Teams/Copilot recap helps people remember the meeting, but it does not reliably turn the meeting into shared execution state.

Product Opportunity
Outcome Handoff: separate decisions, owners, risks, unresolved questions, and follow-ups after a meeting.

Evidence
- Interview Notes: recap was appreciated for memory and catch-up.
- Interview Notes: PM still creates a separate OneNote/Loop checklist.
- Interview Notes: PM manually confirms whether lines are decisions, suggestions, or unresolved questions.
- Teams Chat: teammates asked whether the rollout change was actually decided.
- Teams Chat: teammates asked whether risk review ownership changed.
- Planner/Jira: rollout change has no owner and unconfirmed status.
- Planner/Jira: risk review follow-up owner is still uncertain.

Product Judgment
The problem is not primarily recap length or summary accuracy. The stronger opportunity is execution handoff: turning meeting outcomes into decisions, owners, risks, unresolved questions, and follow-ups that a team can act on.

Validation Plan
Compare normal recap vs Outcome Handoff with PMs running launch reviews. Measure decision/owner identification time, number of clarification messages, and PM confidence that the team shares the same execution state.

Next Actions
- Mock editable Outcome Handoff categories.
- Test with 5 PMs who run cross-functional launch reviews.
- Compare against normal recap.
- Decide whether this belongs in Teams recap, Planner, Loop, or a new handoff layer.`;

  const scriptedFinalCanvasCards = [
    {
      title: "Focus",
      kind: "focus",
      body: "Find the real opportunity in post-meeting Copilot/Teams follow-through.",
    },
    {
      title: "Observation",
      kind: "idea",
      body:
        "Interview Notes: recap is useful for memory and catch-up. Interview Notes: PM still creates a OneNote/Loop checklist and confirms owners manually. Teams Chat: teammates still ask what was decided and who owns follow-ups.",
    },
    {
      title: "Context",
      kind: "idea",
      body:
        "The PM is in a launch-review workflow: Meeting Discussion -> Recap -> PM Checklist -> Owner Confirmation -> Planner/Jira Update. The recap is an input to a handoff process, not the final execution state.",
    },
    {
      title: "Analysis",
      kind: "idea",
      body:
        "Old hypothesis: Recap Quality. Status: weakened by evidence because Interview Notes say the participant liked the recap. Working hypothesis: Execution Handoff. Reason: the PM still manually converts recap content into decisions, owners, risks, unresolved questions, and follow-ups.",
    },
    {
      title: "Evidence: Interview Notes",
      kind: "idea",
      body:
        "Recap appreciated for memory and catch-up. Separate checklist still created. PM manually checks whether lines are decisions, suggestions, or unresolved questions.",
    },
    {
      title: "Evidence: Teams Chat",
      kind: "idea",
      body:
        "\"Was the rollout change actually decided?\" Risk review ownership also remains unclear after the meeting.",
    },
    {
      title: "Evidence: Planner/Jira",
      kind: "idea",
      body:
        "Confirm rollout change has no owner and unconfirmed status. Risk review follow-up owner is uncertain. Sharing next steps waits on a decision list.",
    },
    {
      title: "Action Outline",
      kind: "next",
      body:
        "Outcome Handoff: separate decisions, owners, risks, unresolved questions, and follow-ups. Validate against normal recap with 5 PMs; measure decision/owner identification time, clarification messages, and confidence in shared execution state.",
    },
  ];

  const expectedOutcome = `Golden rubric for Demo Script V3 Lite:
- The demo starts from a short uncertain PM voice input plus uploaded context, not a polished briefing.
- The initial canvas has Focus, Observation, Context, Analysis, and Action cards.
- The Analysis card makes the weak initial hypothesis visible: Recap Quality / recap detail may be the bottleneck.
- The system must not jump directly to Outcome Handoff in the first canvas generation.
- The weak hypothesis is explicitly tested and rejected or weakened because Interview Notes say the participant liked the recap.
- Evidence is attached to the existing structure rather than appearing only in the final artifact.
- Evidence includes plain-text source labels: Interview Notes, Teams Chat, and Planner/Jira.
- The workflow can be represented with ordinary cards: Meeting Discussion -> Recap -> PM Checklist -> Owner Confirmation -> Planner/Jira Update.
- Analysis revises from Recap Quality to Execution Handoff.
- The final Action Outline includes Outcome Handoff, a validation plan, and concrete next actions.
- The output should not expose S0/S1/S2/S3 in visible card titles, paste raw uploaded context, or create a flat disconnected card list.

Agent reply quality rubric:
- Agent replies should be short enough for a live demo and should not dominate the interaction.
- Agent should record uncertainty first, then invite hypothesis testing instead of asserting the final answer.
- Agent should explicitly ground at least one reply in uploaded evidence.
- Agent should guide the user from context/workflow understanding into analysis.
- Agent should revise or strengthen the working hypothesis only after evidence appears.
- Agent should frame the final action as evidence-supported opportunity, not as a magically generated answer.`;

  const normalize = (value) => String(value ?? "").toLowerCase();
  const combinedCardText = (cards) => cards.map((card) => `${card.title}\n${card.body}`).join("\n\n");
  const titleKey = (value) => String(value ?? "").trim().toUpperCase();
  const hasAny = (text, patterns) => patterns.some((pattern) => normalize(text).includes(pattern));
  const wordCount = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
  const hasRawLeak = (cards) =>
    cards.some((card) => {
      const body = String(card.body ?? "");
      return body.includes("[Uploaded context summary]") || body.length > 900;
    });

  const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

  const scoreAgentReplies = (replies) => {
    const allText = replies.join("\n");
    const counts = replies.map(wordCount);
    const maxWords = Math.max(...counts);
    const avgWords = average(counts);
    const hasHypothesisCapture = hasAny(allText, ["current hypothesis", "hypothesis"]);
    const hasTestMove = hasAny(allText, ["test that", "challenge", "evidence"]);
    const hasSourceGrounding = hasAny(allText, [
      "interview notes",
      "teams chat",
      "planner/jira",
      "liked the recap",
      "checklist",
      "owner",
      "decided",
    ]);
    const hasContextToWorkflowGuide = hasAny(allText, ["workflow", "reorganize these observations", "where the friction begins"]);
    const hasRevisionMove = hasAny(allText, [
      "execution handoff",
      "recap quality",
      "recap detail",
      "explains more",
      "pointing in one direction",
      "evidence is pointing",
    ]);
    const hasNonMagicalFinal = hasAny(allText, [
      "evidence supports",
      "collected enough evidence",
      "supports the opportunity",
      "based on the evidence",
    ]);
    const avoidsPrematureAnswer = replies.slice(0, 4).every((reply) => !hasAny(reply, ["outcome handoff"]));
    const conciseEnough = avgWords <= 18 && maxWords <= 38;

    const checks = {
      conciseEnough,
      hasHypothesisCapture,
      hasTestMove,
      hasSourceGrounding,
      hasContextToWorkflowGuide,
      hasRevisionMove,
      hasNonMagicalFinal,
      avoidsPrematureAnswer,
    };
    const passedCount = Object.values(checks).filter(Boolean).length;
    return {
      score: Math.round((passedCount / Object.keys(checks).length) * 100),
      avgWords,
      maxWords,
      checks,
    };
  };

  const scoreTrajectoryContract = ({ cards, artifact = "", expected = "" }) => {
    const text = `${combinedCardText(cards)}\n\n${artifact}\n\n${expected}`;
    const checks = {
      hasObservation: hasAny(text, ["recap is useful", "checklist", "owner", "what was decided"]),
      hasContextWorkflow: hasAny(text, ["meeting discussion", "pm checklist", "owner confirmation", "planner/jira update"]),
      hasWeakHypothesis: hasAny(text, ["recap quality", "recap detail"]),
      rejectsWeakHypothesis: hasAny(text, ["weakened", "liked the recap", "recap appreciated"]),
      revisesToExecutionHandoff: hasAny(text, ["execution handoff"]),
      hasSourceEvidence: hasAny(text, ["interview notes"]) && hasAny(text, ["teams chat"]) && hasAny(text, ["planner/jira"]),
      hasOutcomeHandoff: hasAny(text, ["outcome handoff"]),
      hasValidationPlan: hasAny(text, ["validation plan", "compare normal recap"]),
      hasNextActions: hasAny(text, ["next actions", "test with 5 pms"]),
    };
    const passedCount = Object.values(checks).filter(Boolean).length;
    return {
      score: Math.round((passedCount / Object.keys(checks).length) * 100),
      checks,
    };
  };

  const scoreRealCanvasHygiene = ({ cards, edges }) => {
    const text = combinedCardText(cards);
    const layerNames = ["focus", "observation", "context", "analysis", "action"];
    const layerCounts = Object.fromEntries(
      layerNames.map((layer) => [
        layer,
        cards.filter((card) => String(card.title ?? "").trim().toLowerCase() === layer).length,
      ]),
    );
    const duplicateLayers = Object.entries(layerCounts).filter(([, count]) => count > 1);
    const topLevelLikeCards = cards.filter((card) => {
      const title = String(card.title ?? "").trim().toLowerCase();
      return layerNames.includes(title) || title.includes("hypothesis") || title.includes("opportunity");
    });
    const longBodies = cards.filter((card) => String(card.body ?? "").length > 700);
    const likelyRawLeaks = cards.filter((card) =>
      hasAny(`${card.title}\n${card.body}`, [
        "{\"",
        "metadata",
        "uuid",
        "patient",
        "hospital",
        "export json",
        "export csv",
        "uploaded context summary",
      ]),
    );
    const sourceIds = new Set(edges.map((edge) => edge.source));
    const targetIds = new Set(edges.map((edge) => edge.target));
    const connectedIds = new Set([...sourceIds, ...targetIds]);
    const disconnectedCards = cards.filter((card) => card.id && cards.length > 1 && !connectedIds.has(card.id));
    const checks = {
      noVeryLongBodies: longBodies.length === 0,
      noLikelyRawLeaks: likelyRawLeaks.length === 0,
      notTooManyCards: cards.length <= 16,
      hasSomeConnections: cards.length <= 1 || edges.length > 0,
      fewDisconnectedCards: disconnectedCards.length <= Math.max(2, Math.ceil(cards.length * 0.35)),
      noDuplicateLayerCards: duplicateLayers.length === 0,
      compactTopLevelStructure: topLevelLikeCards.length <= 8,
    };
    const passedCount = Object.values(checks).filter(Boolean).length;
    return {
      score: Math.round((passedCount / Object.keys(checks).length) * 100),
      checks,
      longBodies,
      likelyRawLeaks,
      disconnectedCards,
      duplicateLayers,
      layerCounts,
      topLevelLikeCards,
      textPreview: text.slice(0, 1200),
    };
  };

  const implementationHints = ({ trajectory, agent, source }) => {
    const hints = [];
    if (!trajectory.checks.hasObservation || !trajectory.checks.hasContextWorkflow) {
      hints.push("structureVoiceToCanvas / realtime propose_canvas_ops: strengthen Observation and Context/workflow card creation.");
    }
    if (!trajectory.checks.hasWeakHypothesis || !trajectory.checks.rejectsWeakHypothesis) {
      hints.push("Realtime agent prompt + Analysis card ops: make weak hypothesis testing and rejection explicit.");
    }
    if (!trajectory.checks.revisesToExecutionHandoff) {
      hints.push("Analysis generation: require hypothesis revision from Recap Quality to Execution Handoff when evidence supports it.");
    }
    if (!trajectory.checks.hasSourceEvidence) {
      hints.push("Uploaded context injection / evidence cards: preserve source labels like Interview Notes, Teams Chat, Planner/Jira.");
    }
    if (!trajectory.checks.hasOutcomeHandoff || !trajectory.checks.hasValidationPlan || !trajectory.checks.hasNextActions) {
      hints.push("Action generation: require Outcome Handoff, validation plan, and concrete next actions only after evidence appears.");
    }
    if (!agent.checks.conciseEnough || !agent.checks.hasTestMove || !agent.checks.hasSourceGrounding) {
      hints.push("SOCRATIC_INSTRUCTIONS_BASE: tune Realtime Agent for concise evidence-grounded hypothesis testing.");
    }
    if (source !== "real canvas snapshot") {
      hints.push("Run a real demo turn first: current trajectory score is still using scripted golden canvas, not implementation output.");
    }
    return hints;
  };

  const getRealRunSnapshot = () => {
    const snapshot = window.__murmurDemoSnapshot;
    if (!snapshot || typeof snapshot !== "object") return null;
    const canvas = snapshot.canvas && typeof snapshot.canvas === "object" ? snapshot.canvas : null;
    const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
    const edges = Array.isArray(canvas?.edges) ? canvas.edges : [];
    const cards = nodes
      .map((node) => ({
        id: String(node?.id ?? ""),
        title: String(node?.title ?? ""),
        body: String(node?.body ?? ""),
        kind: String(node?.kind ?? "idea"),
      }))
      .filter((card) => card.title.trim() || card.body.trim());
    const transcript = Array.isArray(snapshot.transcript) ? snapshot.transcript : [];
    const realtimeEvents = Array.isArray(snapshot.realtimeAgentReplies) ? snapshot.realtimeAgentReplies : [];
    const contextFiles = Array.isArray(snapshot.contextFiles) ? snapshot.contextFiles : [];
    return { snapshot, cards, edges, transcript, realtimeEvents, contextFiles };
  };

  const assert = (condition, message, detail) => {
    if (!condition) {
      console.error(`%cFAIL%c ${message}`, "color:#dc2626;font-weight:bold", "color:inherit", detail ?? "");
      return false;
    }
    console.log(`%cPASS%c ${message}`, "color:#16a34a;font-weight:bold", "color:inherit");
    return true;
  };

  console.log("%c=== cognitive demo golden test V3 Lite ===", "color:#0284c7;font-weight:bold");

  const realRun = getRealRunSnapshot();
  if (realRun) {
    console.log("%c[real-run snapshot detected]", "color:#7c3aed;font-weight:bold", {
      cards: realRun.cards.length,
      edges: realRun.edges.length,
      transcript: realRun.transcript.length,
      realtimeAgentReplies: realRun.realtimeEvents.length,
      contextFiles: realRun.contextFiles.length,
      snapshot: realRun.snapshot,
    });
  } else {
    console.log("[real-run snapshot missing] using server-function scaffold + scripted golden cards");
  }

  const { structureVoiceToCanvas } = await import("/src/lib/orchestrator/structureVoiceToCanvas.functions.ts");
  const { evaluateCognitiveTrajectory } = await import("/src/lib/orchestrator/evaluateCognitiveTrajectory.functions.ts");

  console.group("1) structureVoiceToCanvas: initial scaffold");
  const canvas = await structureVoiceToCanvas({
    data: {
      rawTranscript,
      existingCards: [],
      model: MODEL,
    },
  });
  console.table(canvas.cards.map((card) => ({ title: card.title, kind: card.kind, body: card.body })));

  const titles = new Set(canvas.cards.map((card) => titleKey(card.title)));
  const cardText = combinedCardText(canvas.cards);
  const analysisCard = canvas.cards.find((card) => titleKey(card.title) === "ANALYSIS");
  const analysisText = `${analysisCard?.title ?? ""}\n${analysisCard?.body ?? ""}`;

  const structurePasses = [
    assert(canvas.cards.some((card) => card.kind === "focus" || titleKey(card.title) === "FOCUS"), "has focus card", canvas.cards),
    assert(titles.has("OBSERVATION") || titles.has("OBSERVATIONS"), "has Observation card", [...titles]),
    assert(titles.has("CONTEXT"), "has Context card", [...titles]),
    assert(titles.has("ANALYSIS"), "has Analysis card", [...titles]),
    assert(titles.has("ACTION"), "has Action card", [...titles]),
    assert(![...titles].some((title) => /^S[0-3]\b/.test(title)), "does not expose S0-S3 in visible titles", [...titles]),
    assert(!hasRawLeak(canvas.cards), "does not paste raw uploaded context into cards", canvas.cards),
    assert(
      hasAny(analysisText, ["recap quality", "recap detail", "recap"]),
      "initial Analysis captures the weak recap hypothesis",
      analysisCard,
    ),
    assert(
      !hasAny(cardText, ["outcome handoff", "execution handoff"]),
      "initial canvas does not jump straight to final handoff solution",
      cardText,
    ),
  ];
  console.groupEnd();

  console.group("2) deterministic script contract");
  const scriptedEvidenceText = `${turns.join("\n")}\n${agentReplies.join("\n")}\n${finalArtifact}`;
  const scriptPasses = [
    assert(hasAny(scriptedEvidenceText, ["interview notes"]), "script includes Interview Notes evidence", scriptedEvidenceText),
    assert(hasAny(scriptedEvidenceText, ["teams chat"]), "script includes Teams Chat evidence", scriptedEvidenceText),
    assert(hasAny(scriptedEvidenceText, ["planner/jira"]), "script includes Planner/Jira evidence", scriptedEvidenceText),
    assert(hasAny(scriptedEvidenceText, ["liked the recap", "recap was appreciated"]), "script challenges the weak recap-quality hypothesis", scriptedEvidenceText),
    assert(hasAny(scriptedEvidenceText, ["execution handoff"]), "script revises to Execution Handoff", scriptedEvidenceText),
    assert(hasAny(scriptedEvidenceText, ["outcome handoff"]), "final artifact names Outcome Handoff", finalArtifact),
    assert(hasAny(scriptedEvidenceText, ["validation plan"]), "final artifact includes validation plan", finalArtifact),
    assert(hasAny(scriptedEvidenceText, ["next actions"]), "final artifact includes next actions", finalArtifact),
  ];
  console.groupEnd();

  console.group("3) agent reply helpfulness");
  const realtimeReplyEvents = realRun?.realtimeEvents?.length
    ? realRun.realtimeEvents
    : Array.isArray(window.__murmurRealtimeAgentReplies)
    ? window.__murmurRealtimeAgentReplies
    : [];
  const realtimeAgentReplies = realtimeReplyEvents
    .map((event) => event?.text)
    .filter((text) => typeof text === "string" && text.trim())
    .map((text) => text.trim());
  const agentRepliesUnderTest = realtimeAgentReplies.length > 0 ? realtimeAgentReplies : agentReplies;
  const agentReplySource = realtimeAgentReplies.length > 0 ? "realtime" : "scripted fallback";
  console.log(`agent reply source: ${agentReplySource}`, agentRepliesUnderTest);
  const agentHelpfulness = scoreAgentReplies(agentRepliesUnderTest);
  console.log(agentHelpfulness);
  const agentPasses = [
    assert(agentHelpfulness.score >= 85, "agent helpfulness score >= 85", agentHelpfulness),
    assert(agentHelpfulness.checks.conciseEnough, "agent replies stay concise for live demo", agentHelpfulness),
    assert(agentHelpfulness.checks.hasHypothesisCapture, "agent records the initial hypothesis", agentRepliesUnderTest),
    assert(agentHelpfulness.checks.hasTestMove, "agent invites hypothesis testing", agentRepliesUnderTest),
    assert(agentHelpfulness.checks.hasSourceGrounding, "agent grounds at least one reply in uploaded evidence", agentRepliesUnderTest),
    assert(agentHelpfulness.checks.hasContextToWorkflowGuide, "agent guides context into workflow understanding", agentRepliesUnderTest),
    assert(agentHelpfulness.checks.hasRevisionMove, "agent supports hypothesis revision", agentRepliesUnderTest),
    assert(agentHelpfulness.checks.hasNonMagicalFinal, "agent frames final action as evidence-supported", agentRepliesUnderTest),
    assert(agentHelpfulness.checks.avoidsPrematureAnswer, "agent does not reveal final answer too early", agentRepliesUnderTest),
  ];
  console.groupEnd();

  const realRunHasCanvas = Boolean(realRun && realRun.cards.length > 0);
  const evaluationCanvasCards = realRunHasCanvas ? realRun.cards : [...canvas.cards, ...scriptedFinalCanvasCards];
  const trajectorySource = realRunHasCanvas ? "real canvas snapshot" : "scripted golden canvas";

  console.group("4) deterministic trajectory contract");
  console.log(`trajectory source: ${trajectorySource}`, evaluationCanvasCards);
  const trajectoryContract = scoreTrajectoryContract({
    cards: evaluationCanvasCards,
    artifact: realRunHasCanvas ? "" : finalArtifact,
    expected: realRunHasCanvas ? "" : expectedOutcome,
  });
  const realCanvasHygiene = realRunHasCanvas
    ? scoreRealCanvasHygiene({ cards: realRun.cards, edges: realRun.edges })
    : null;
  console.log(trajectoryContract);
  const trajectoryPasses = [
    assert(trajectoryContract.score >= 90, "trajectory contract score >= 90", trajectoryContract),
    assert(trajectoryContract.checks.hasObservation, "trajectory includes Observation evidence", trajectoryContract),
    assert(trajectoryContract.checks.hasContextWorkflow, "trajectory includes Context/workflow", trajectoryContract),
    assert(trajectoryContract.checks.hasWeakHypothesis, "trajectory includes weak Recap Quality hypothesis", trajectoryContract),
    assert(trajectoryContract.checks.rejectsWeakHypothesis, "trajectory weak hypothesis is challenged", trajectoryContract),
    assert(trajectoryContract.checks.revisesToExecutionHandoff, "trajectory revises to Execution Handoff", trajectoryContract),
    assert(trajectoryContract.checks.hasSourceEvidence, "trajectory includes all source evidence labels", trajectoryContract),
    assert(trajectoryContract.checks.hasOutcomeHandoff, "trajectory reaches Outcome Handoff", trajectoryContract),
    assert(trajectoryContract.checks.hasValidationPlan, "trajectory includes validation plan", trajectoryContract),
    assert(trajectoryContract.checks.hasNextActions, "trajectory includes next actions", trajectoryContract),
  ];
  const hints = implementationHints({
    trajectory: trajectoryContract,
    agent: agentHelpfulness,
    source: trajectorySource,
  });
  const hygienePasses = realCanvasHygiene
    ? [
        assert(realCanvasHygiene.score >= 80, "real canvas hygiene score >= 80", realCanvasHygiene),
        assert(realCanvasHygiene.checks.noVeryLongBodies, "real canvas avoids oversized raw bodies", realCanvasHygiene),
        assert(realCanvasHygiene.checks.noLikelyRawLeaks, "real canvas avoids raw/irrelevant data leaks", realCanvasHygiene),
        assert(realCanvasHygiene.checks.notTooManyCards, "real canvas avoids card explosion", realCanvasHygiene),
        assert(realCanvasHygiene.checks.hasSomeConnections, "real canvas has some structure connections", realCanvasHygiene),
        assert(realCanvasHygiene.checks.fewDisconnectedCards, "real canvas avoids mostly disconnected islands", realCanvasHygiene),
        assert(realCanvasHygiene.checks.noDuplicateLayerCards, "real canvas does not duplicate layer cards", realCanvasHygiene),
        assert(realCanvasHygiene.checks.compactTopLevelStructure, "real canvas keeps top-level structure compact", realCanvasHygiene),
      ]
    : [];
  if (realCanvasHygiene && realCanvasHygiene.score < 80) {
    hints.push("Canvas hygiene: investigate raw context/image/OCR leakage, oversized cards, or disconnected card islands.");
  }
  if (realCanvasHygiene && !realCanvasHygiene.checks.noDuplicateLayerCards) {
    hints.push("Canvas mutation: Agent is duplicating layer cards instead of updating Focus/Observation/Context/Analysis/Action.");
  }
  if (hints.length) console.warn("implementation hints", hints);
  else console.log("%cimplementation hints%c none", "color:#16a34a;font-weight:bold", "color:inherit");
  console.groupEnd();

  console.group("5) evaluateCognitiveTrajectory: LLM diagnostic");
  const evaluation = await evaluateCognitiveTrajectory({
    data: {
      rawTranscript,
      turns,
      agentReplies,
      canvasCards: evaluationCanvasCards.map((card) => ({ title: card.title, body: card.body, kind: card.kind })),
      finalArtifact,
      expectedOutcome,
      model: MODEL,
    },
  });
  console.log(evaluation);

  const blockingFailures = (evaluation.failureTags ?? []).filter((tag) => BLOCKING_TAGS.has(tag));
  const evalDiagnostics = {
    pass: evaluation.pass === true,
    overallAtLeast4: evaluation.overall >= 4,
    S1AtLeast4: evaluation.layerScores?.S1_contextual >= 4,
    S2AtLeast4: evaluation.layerScores?.S2_analytical >= 4,
    S3AtLeast4: evaluation.layerScores?.S3_actionable >= 4,
    S1ToS2AtLeast4: evaluation.transitionScores?.S1_to_S2 >= 4,
    S2ToS3AtLeast4: evaluation.transitionScores?.S2_to_S3 >= 4,
    noBlockingFailures: blockingFailures.length === 0,
  };
  console.log("LLM diagnostic checks", evalDiagnostics);
  if (evaluation.pass === true) {
    console.log("%cPASS%c LLM evaluator agrees with golden trajectory", "color:#16a34a;font-weight:bold", "color:inherit");
  } else {
    console.warn("LLM evaluator is diagnostic-only for now; deterministic contract decides golden pass.", evaluation);
  }
  console.groupEnd();

  const passed = [...structurePasses, ...scriptPasses, ...agentPasses, ...trajectoryPasses, ...hygienePasses].every(Boolean);
  window.__cognitiveDemoGoldenTest = {
    passed,
    canvas,
    realRunSnapshot: realRun?.snapshot ?? null,
    trajectorySource,
    scriptedFinalCanvasCards,
    realtimeReplyEvents,
    realtimeAgentReplies,
    agentReplySource,
    agentHelpfulness,
    trajectoryContract,
    realCanvasHygiene,
    implementationHints: hints,
    evaluation,
    evalDiagnostics,
    rawTranscript,
    turns,
    agentReplies,
    finalArtifact,
    expectedOutcome,
  };

  if (passed) console.log("%c=== GOLDEN TEST PASSED ===", "color:#16a34a;font-weight:bold");
  else console.error("%c=== GOLDEN TEST FAILED ===", "color:#dc2626;font-weight:bold");
  console.log("[test] details on window.__cognitiveDemoGoldenTest");
})();

// ============================================================================
// ArtifactView Renderer V0 console test — paste into the browser console on
// /workbench. Tests CanvasArtifactViewV0 -> IdeaCanvasState in isolation.
// ============================================================================
(async () => {
  const {
    renderArtifactViewToIdeaCanvasV0,
    formatIdeaCanvasStateV0,
  } = await import("/src/lib/orchestrator/artifactViewRendererV0.ts");

  const checks = [];
  const artifact = {
    artifactType: "prd",
    title: "AI 学习助手",
    activeSectionId: "target_user",
    sections: [
      {
        id: "target_user",
        heading: "目标用户",
        bullets: ["大学生，已经使用 AI / ChatGPT 获取答案。"],
        children: [],
        sourceNodeIds: ["target_students"],
        status: "active",
      },
      {
        id: "user_need",
        heading: "用户需求",
        bullets: [],
        children: [
          { id: "understand_concepts", heading: "理解新概念", bullets: [], sourceNodeIds: [], status: "empty" },
          { id: "apply_practice", heading: "练习和应用", bullets: [], sourceNodeIds: [], status: "empty" },
        ],
        sourceNodeIds: [],
        status: "empty",
      },
      { id: "core_features", heading: "核心功能", bullets: [], children: [], sourceNodeIds: [], status: "empty" },
      { id: "market_research", heading: "市场调研", bullets: [], children: [], sourceNodeIds: [], status: "empty" },
    ],
  };

  const first = renderArtifactViewToIdeaCanvasV0(artifact);
  console.group("First render");
  console.log(formatIdeaCanvasStateV0(first));
  console.log(first);
  console.groupEnd();

  const nodeText = (canvas) => JSON.stringify(canvas.nodes.map((node) => node.data));
  checks.push(["creates focus node", first.nodes.some((node) => node.data.kind === "focus" && node.data.title === "AI 学习助手")]);
  checks.push(["creates four section nodes", first.nodes.filter((node) => /目标用户|用户需求|核心功能|市场调研/.test(node.data.title)).length === 4]);
  checks.push(["keeps detail bullet in card body", first.nodes.some((node) => node.data.title === "目标用户" && /ChatGPT/.test(node.data.body ?? ""))]);
  checks.push(["renders children as nodes", first.nodes.some((node) => node.data.title === "理解新概念") && first.nodes.some((node) => node.data.title === "练习和应用")]);
  checks.push(["active section selected", first.nodes.some((node) => node.selected && node.data.title === "目标用户")]);
  checks.push(["does not draw focus-section clutter", first.edges.filter((edge) => edge.source.includes("focus")).length === 0]);
  checks.push(["keeps section-child hierarchy edges", first.edges.length === 2]);
  checks.push(["no dangling edges", first.edges.every((edge) => first.nodes.some((node) => node.id === edge.source) && first.nodes.some((node) => node.id === edge.target))]);
  checks.push(["artifact nodes are locked", first.nodes.every((node) => node.data.layoutMode === "artifact" && node.data.locked === true)]);

  const updated = renderArtifactViewToIdeaCanvasV0(
    {
      ...artifact,
      activeSectionId: "user_need",
      sections: artifact.sections.map((section) =>
        section.id === "target_user"
          ? { ...section, status: "filled" }
          : section.id === "user_need"
            ? { ...section, status: "active", bullets: ["学生需要从答案走向理解。"] }
            : section,
      ),
    },
    first,
  );
  console.group("Updated render");
  console.log(formatIdeaCanvasStateV0(updated));
  console.log(updated);
  console.groupEnd();

  checks.push(["updates without duplicating focus", updated.nodes.filter((node) => node.data.title === "AI 学习助手").length === 1]);
  checks.push(["updates user need card body", updated.nodes.some((node) => node.data.title === "用户需求" && /从答案走向理解/.test(node.data.body ?? ""))]);
  checks.push(["moves active selection", updated.nodes.some((node) => node.selected && node.data.title === "用户需求")]);
  checks.push(["keeps hierarchy edges only", updated.edges.length === 2 && updated.edges.every((edge) => !edge.source.includes("focus"))]);

  const passed = checks.filter(([, ok]) => ok).length;
  console.table(checks.map(([check, pass]) => ({ check, pass: Boolean(pass) })));
  console.log(
    `%c${passed}/${checks.length} checks passed`,
    passed === checks.length ? "color:#16a34a" : "color:#dc2626",
  );
})();

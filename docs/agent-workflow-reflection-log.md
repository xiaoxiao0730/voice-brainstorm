# Agent Workflow Reflection Log

## 当前 thesis

这个 demo 不再优先展示「AI 自动总结用户在想什么」，而是展示一个 **Artifact Scaffolding Workspace**：

```text
零散语音输入
-> 判断用户想产出的 artifact
-> 搭建轻量 scaffold
-> 每轮更新一个明确 section
-> 语音 agent 引导下一块
-> 最终导出可执行 artifact
```

在这个模式里，cognitive exploration 仍然重要，但它是内部能力：用来判断用户真正需要哪个产出物、下一步应该填哪一块、是否需要 reframe。它不应该每次都显性暴露成 hidden tension / assumption shift / reframed question。

## 当前 demo contract

V1 先服务 AI 学习产品 PRD demo。

理想路径：

```text
User: 我想做 AI 学习产品，但没想清楚方向
Agent: 建议先搭一个轻量 PRD：目标用户、用户需求、核心功能、市场调研

User: 好的，就这么写
Canvas: AI 学习产品 PRD + 四个 section
Agent: 先从目标用户开始

User: 主要是大学生，已经用 ChatGPT 获取答案，但只是完成作业，没有应用知识
Canvas: 更新「目标用户」
Agent: 核心问题不是获取不到答案，而是如何从答案走向理解；下一步填「用户需求」
```

## Pipeline 分工

### Realtime Voice Layer

文件：`src/lib/agent/realtimeClient.ts`

职责：

- 负责短语音交互和 turn-taking。
- 优先遵循 `[thought turn contract]` 注入的 `voiceReplyHint`。
- 在 artifact mode 中不主动写 canvas，除非用户明确要求手动改卡。
- 回复形态：一句 reframe + 一个 section-level next prompt。

质量标准：

- 不频繁问「你想从哪个方向切入」。
- 不把用户带回泛泛 brainstorming。
- 不暴露 cognitive intervention 内部字段。

### Thought Turn Orchestrator

文件：`src/lib/orchestrator/thoughtTurnContract.functions.ts`

职责：

- 判断 interaction mode。
- 维护 artifact state。
- 决定是否创建 scaffold、更新 section、切换 active section。
- 生成 voice hint。

V1 关键模式：

```text
artifact_proposal
artifact_scaffolding
section_filling
artifact_export
```

### Artifact State

文件：`src/lib/agent/artifactState.ts`

职责：

- 定义 PRD artifact schema。
- 固定 V1 sections：目标用户、用户需求、核心功能、市场调研。
- 提供 normalize / format / next section helper。

### Canvas Renderer

文件：`src/routes/_authenticated/workbench.tsx`

职责：

- 把 artifact state 渲染成稳定 canvas。
- Focus card 固定为 `AI 学习产品 PRD`。
- Section cards 位置固定，不随每轮更新漂移。
- 后续输入只更新已有 section，不重复创建孤立卡。

### Persistence

文件：`supabase/migrations/20260709090000_session_artifact_state.sql`

职责：

- 在 `session_thinking_state` 中保存 `artifact_state jsonb`。
- 支持跨轮 state transition。

### Manual Test

文件：`scripts/test-artifact-scaffold.console.js`

职责：

- 不用麦克风，直接测试真实 `planThoughtTurnContract` 输出。
- 检查 artifact proposal、scaffold creation、section update、voice guidance。

## 当前最大风险

1. Realtime agent 仍可能在第一轮自动回复早于 slow-lane contract 注入，因此第一句质量仍部分依赖 realtime prompt。
2. Artifact section compression 目前 V1 有 deterministic 兜底，适合 demo，但还不是通用 semantic extraction。
3. Canvas renderer 现在服务 PRD scaffold，Research Proposal 等 artifact 还没有 UI layout。
4. `structureVoiceToCanvas` 仍保留 cognitive scaffold 逻辑，手动 canvas capture 与 artifact mode 是两条路径。

## 下一轮测试记录模板

```text
日期：
测试输入：
期望输出：
实际 voice reply：
实际 canvas：

通过项：
- hasArtifactType:
- proposesPRDScaffold:
- scaffoldCreatedAfterAcceptance:
- updatesExistingSection:
- noDuplicateSections:
- voiceGuidesOneSection:
- avoidsBroadQuestioning:
- layoutStable:
- doesNotExposeCognitiveIntervention:

失败原因：
下一步改动：
```


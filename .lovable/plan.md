## Goal

Replace the current regex-routed, mutex-gated two-lane setup with a **真正并行的双流水线**:

- **Realtime Lane** — OpenAI Realtime 用原生 server_vad + create_response，担任实时引导启发的语音陪伴者；只负责语音，不碰画布。
- **Background Canvas Lane** — 每条 committed STT 文本无条件触发后台慢模型，直接产出 Ghost Patch 流式渲染到 Live Brief 不弹出卡片而是直接在live brief上生成总结和Agent回复；不再被"Realtime 在说话"或"Fast Lane 刚说过"降级/阻塞。
- **可选反哺** — 后台得到重大洞察时，通过 Realtime data channel 把简短结论作为 system 增量上下文注入当前 session，让后续语音回答自然带上深度知识。

## Changes

### 1. `src/lib/agent/realtimeClient.ts` — 启用原生 Realtime 对谈

- `session.update` 改为：
  - `instructions`：换成"苏格拉底式头脑风暴引导教练"提示词 — 简短自然语音回应；倾听完整想法时保持沉默；只在用户停顿/出现关键缺口时抛出一句轻量启发式提问；**明确禁止修改 Live Brief 或调用任何 patch**。
  - `audio.input.turn_detection`: `type: "server_vad"`, `create_response: true`, `interrupt_response: true`（阈值/padding 保留现值）。
- 移除"silent by default / never start a turn"那段约束。
- 新增 `injectContext(note: string)` 方法：通过 data channel 发送 `conversation.item.create`（role: system，简短上下文），不触发 response，仅作为后续 turn 的隐式知识。
- 保留 `speak()` / `cancel()` / `isAgentSpeaking()` API（speak 仍可用于把后台洞察作为正式开口的兜底）。

### 2. 删除前端正则抢答链路

- 删除文件：
  - `src/lib/agent/fastIntent.ts`
  - `src/lib/agent/fastReply.functions.ts`
- 从 `src/routes/_authenticated/workbench.tsx` 移除所有相关 import、`runFastLane`、`fastReplyFn`、`classifyFastIntent` 调用、`agentMode`/`muted`/control 分支、`AgentSuggestionCard` 文本卡的 fast-lane 用法。
- 不再需要时也清理 `loadAgentMode/saveAgentMode` 的引用（`agentMode.ts` 文件本身可保留为 no-op 或一并删除——见下方"待定"）。

### 3. `src/lib/agent/interventionPolicy.ts` — 大幅瘦身

彻底删除互斥状态机，只保留极小的"反复提议防抖"以避免画布被刷屏：

- 移除 `fast` lane 状态、`isFastRecent`、`recordFast`、`MIN_VOICE_GAP_MS`、voice 降级逻辑、`BackgroundDecision` 中的 voice/text_suggestion 分支。
- 新 API：
  - `shouldEmitCanvas(): boolean` — 仅基于"距上次 ghost patch ≥ N 秒 且 当前没有未消费的 ghost"做节流，默认放行。
  - `recordCanvas()` / `recordFeedback()` 仍保留，用于轻量节流和负反馈惩罚。
- 不再读"Realtime 是否在说话"。

### 4. `src/lib/agent/responseGenerator.functions.ts` — 只保留 canvas 路径

- 删除 `SYSTEM_TEXT_VOICE`、`level` 入参中的 `text` / `voice` 分支与对应代码路径。
- `InputSchema` 移除 `level`；handler 永远走 canvas/Ghost Patch 流程。
- 返回结构增加可选 `insight?: string`（≤120 字的核心洞察短句，供 Realtime 注入；模型在 schema 中 optional 输出）。
- 升级默认模型到更深推理档（如 `google/gemini-2.5-pro`），保持 prompt 强调"基于用户原话和现有 brief，不要编造"。

### 5. `src/routes/_authenticated/workbench.tsx` — 简化触发链

- `onSegment` 中：移除 `runFastLane` 调用；**无条件** `void runBackgroundLane(segment)`，不再依赖 `agentEnabledRef`（只要 `listening` 就跑画布）。
- 重写 `runBackgroundLane`：
  - 不再调 `classifyFastIntent` 跳过控制语；不再调 `detectThinkingState`（或保留作为节流信号，但不影响是否触发）。
  - 直接调用 `generateNudge`（canvas 模式），拿到 patch → `setGhostPatch(...)`。
  - 若返回 `insight` 且 `realtimeRef.current` 在线 → `realtimeRef.current.injectContext(insight)`（best-effort，失败仅 warn）。
  - 不再因 `realtimeRef.current?.isAgentSpeaking()` 阻塞或降级。
- 删除：`runFastLane`、所有 `AgentMode`/`muted`/`changeAgentMode`/`fastCannedReply` 相关 state、`AgentSuggestionCard` 文本悬浮卡（保留 `CanvasGhostPatchCard`）。
- `agentEnabled` 现在只控制 **Realtime 语音**（即"Talk with Agent"按钮）；画布 lane 跟随 `listening` 自动开。
- 顺手清理 `lane`/`intent`/`fast` 相关字段的 `logIntervention` 入参，统一 `lane: "structural"`（或重命名为 `canvas`，二选一保持一致）。

### 6. 类型 & 清理

- `interventionLog.functions.ts`：若 `intent` 列只剩 fast lane 在用，去掉对应入参 schema 字段，避免无效字段污染。
- `agentMode.ts`：若 UI 上 mode 切换被移除，文件一并删除并移除 import。
- `BackgroundDecision` 类型仅保留 `"silent" | "canvas"`，全项目 grep 替换。
- 跑 `bun run typecheck`（由 harness 自动执行）确认无残留引用。

7.重做Live Brief 画布交互形式，取消ghost patch card 改为“行内暂存与二次确认”机制（Inline Diff / Staging Mode）

不要使用分离的悬浮提示卡片，而是采用类似 Cursor/Copilot 等 Coding 平台的 **“行内 Diff 暂存”** 逻辑：

## Out of scope

- 不动 STT (`azureRecognizer.ts`)、`transcriptBuffer.ts`、`applyBriefPatch.ts`、`orchestrate.functions.ts` 的核心逻辑。
- 不改 DB schema；只清理写入字段。

## 待定（一个小决定，可在实现时直接选）

`agentMode.ts`（listen/guide/answer 三档）随 Fast Lane 一起删除？  
默认：**删除** —— 新架构下 Realtime 永远是"guide"风格，由 prompt 控制；mode 切换没有承载组件。如果你想保留作为未来"静音/激进度"开关，告诉我，我会留文件但移除当前 UI 引用。
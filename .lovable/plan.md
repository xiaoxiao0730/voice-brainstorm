# 下一阶段重点：把"回合制语音 + 滞后笔记"改造成"实时共思工作台"

> **进度**：A1 + A2 已完成 ✅。新建 `bulletLane.functions.ts`，在 workbench `onSegment` 内 fire-and-forget 调用；命中的 bullet 通过现有 `brief.proposed` 总线进入文档（按 pending 渲染）。tracer 增加 `bulletLane.start/end` span，Inspector 增加配色。下一步：B1（InsightAgent + InsightPacket 总线）。

结合你的 PRD（v1/v1.3）、Stage 0 已落地的可观测性、以及你描述的核心体验诉求，问题其实集中在 **三条数据通路** 上。下面是按"对你想要效果的影响 × 可行性"排序的重点调试方向。建议按顺序做，但 A 和 B 完成后 C 自然顺滑。

---

## 诊断结论：现在卡住的根因不是某个 prompt，而是结构

```text
                  [Azure STT segment]
                         │
                         ▼
              ThoughtTurnBuffer (2.5s pause → finalize)
                         │  ← 唯一触发点
                         ▼
   ┌─────────────────────┴────────────────────┐
   ▼                                          ▼
decideBrief (整段 → patches)        Realtime VAD (OpenAI 自带, 自动 create_response)
   ▼                                          ▼
Live Brief (一整段才更新)            语音回复 (跟着 OpenAI 模型走, 没有 deep context)
```

三个结构性问题：

1. **Brief 只在 ThoughtTurn finalize 后更新一次** → 用户讲 30-60s 时面板是死的，"实时笔记"幻觉破灭。
2. **Realtime Agent 的"思考"完全等于 gpt-realtime 本体** → 浅、回合制、抢话。后台的 research / decideBrief 产物从来没有回流到语音侧。
3. **没有 Insight 这一类数据**。现在只有 transcript / patches / research result。语音和文档共享的"中间认知"是空的。

Stage 0 inspector 已经能验证这三点（你会看到 `decideBrief.end` 间隔很长、`voice.response_started` 和 thought_turn 几乎重合、没有 research 注入语音的事件）。

---

## 重点 A：Live Bullet Lane（解决"笔记不实时"）

**目标**：用户讲到一半，brief 就能出现 pending bullet；停顿后 decideBrief 再做结构整理 / 合并 / 升级标题。

新增一条"快车道"，与现在的 decideBrief 慢车道并行：

```text
TranscriptSegment (Azure final, 每 ~3-8s 一条)
        │
        ├──► BulletLane (轻量 LLM, gemini-flash-lite, 200-400ms)
        │       └─ 产出 1-2 条 pending bullet → brief.bulletProposed
        │
        └──► ThoughtTurnBuffer → decideBrief (慢车道, 不变)
                └─ 整理/合并/升级/锁定 pending bullets
```

要点：

- Bullet lane 只回答一个问题："这一段 transcript 里有没有 1 句话能挂在 brief 上？" 输出 `{ text, attachToBlockId? | newBlockTopic }`，强约束 ≤ 20 字。
- UI 上 pending bullet 用浅色 + 小圆点显示，decideBrief 触发后由 coordinator 决定 keep / merge / drop（用 operationId 串起来）。
- 复用现有 `brief.proposed` 事件，加一个 `source: "bullet" | "decide"` 字段，避免 UI 闪烁。
- Stage 0 的 tracer 直接加 `bulletLane.start/end` span 验证延迟。

这一项是用户感知最强的——做完之后"工作台感"立刻成立。

---

## 重点 B：Insight Packet 桥（解决"语音浅 + 后台思考不回流"）

**目标**：让 Realtime Agent 说的话不是"接上一句"，而是"引用刚刚后台形成的判断"。

引入你 PRD 里那个 schema 作为一等公民：

```ts
type InsightPacket = {
  id: string;
  kind: "observation" | "contradiction" | "suggestion" | "question" | "conclusion";
  text: string;            // 1-2 句, 给语音读 / 给 brief 当 bullet
  priority: "low" | "medium" | "high";
  shouldSpeak: boolean;    // 由 interventionPolicy 决定
  briefPatch?: BriefPatch; // 可选, 同时落到 brief
  basedOn: { turnIds: string[]; researchTaskId?: string };
};
```

新增 `InsightAgent`（不联网，纯推理，gemini-2.5-pro 或 gpt-5-mini）：

- 输入：最近 N 个 thoughtTurn + 当前 brief snapshot + 最新 research 结果。
- 触发：每个 thought_turn.finalized 之后跑一次；research.completed 之后再跑一次。
- 输出：0-2 个 InsightPacket，发到 bus。

两个消费者：

1. **Brief 侧**：高优 packet 自动变成 bullet（走 A 的通道）。
2. **Realtime 侧**：通过 `session.update` 把 packet 注入 instructions 的"pending insight"段，并在 `shouldSpeak=true` 时手动 `response.create`——不再依赖 VAD 自动回复。

这是把"research agent 思考结果同步给 realtime"的真正落地点。现在 `researchSynthesizer` 的产物只回 brief，不进语音 context，这就是语音"蠢"的根因之一。

---

## 重点 C：Intervention Policy 重写（解决"回合制 / 抢话"）

**目标**：默认沉默，只在有 Insight 或用户明确求助时开口；开口时短、具体、可被打断。

具体动作：

1. Realtime session 里 **关掉 `turn_detection.create_response`**（之前你打开它是因为没有调度器；现在 InsightAgent 就是调度器）。保留 VAD 只做"用户在说话"的事件，用来打断 TTS、不再用来自动回复。
2. `interventionPolicy.ts` 改成纯函数：`decide(packets, recentVoiceLog, userSilenceMs) → SpeakDecision`。规则示例：
   - 距上次 agent 说话 < 20s → 默认不说。
   - 用户连续讲 > 45s 且出现 `contradiction|conclusion` priority=high → 说。
   - 用户明确 stop / "你怎么看" → 说，且优先消费最高优 packet。
3. 触发说话 = `response.create` 带上当前 packet text 作为 `instructions` 的临时 override，让它讲这句 insight 而不是自由发挥。
4. 语音Realtime Agent和Live Brief共享Thinking State（应该已经实现了）在回答用户问题的时候需要结合已知的Context，需要连接上传的文件也作为Context获取对象。

这一项做完，"低打扰、一小段一小段引导"的体感就出来了。

---

## 建议的实现顺序（每步独立可观测）

1. **A1**：BulletLane server function + tracer span（不接 UI，先用 inspector 看延迟和命中率）。
2. **A2**：UI pending bullet 渲染 + coordinator merge 逻辑。→ 用户立刻看到"实时笔记"。
3. **B1**：InsightAgent + InsightPacket 总线事件 + brief 消费。→ brief 开始出现"矛盾 / 建议"类条目。
4. **C1**：关 realtime auto response，policy 改为基于 packet 触发 `response.create`。→ 体感从"回合"变"低打扰"。
5. **B2**：把 InsightPacket 注入 realtime instructions，让语音真的引用后台判断。→ 语音"有深度"。

每步完成后用 Stage 0 inspector 验证对应 span/事件，不靠"感觉变好了"。

---

## 技术细节（给后续实现用）

- 新文件：`src/lib/pipeline/bulletLane.functions.ts`、`src/lib/agent/insightAgent.functions.ts`、`src/lib/agent/insightBus.ts`（或复用 sessionEvents 加新 type）。
- `sessionEvents.ts` 加事件：`brief.bulletProposed`、`insight.created`、`voice.speakRequested`。
- `realtimeClient.ts`：
  - `turn_detection.create_response = false`、`interrupt_response = true` 保留。
  - 暴露 `requestSpeak(packet)` → 内部发 `response.create` with override instructions。
- `coordinator.ts`：订阅 `brief.bulletProposed` 和 `insight.created`，合并到现有 `brief.proposed` 流，统一 operationId。
- decideBrief prompt 调整：从"决定要不要写"放宽为"整理已有 pending bullets + 决定升级/合并"，因为快车道已经在写了。
- 模型选择：bullet lane 用 `google/gemini-3-flash-preview`（已是默认，便宜快）；InsightAgent 用 `openai/gpt-5-mini` 或 `google/gemini-2.5-pro`（推理质量更重要，频率低）。

---

## 不建议现在做的事

- 不要再调 decideBrief 的 prompt 让它"更频繁"——根因是它只在 turn 边界触发，不是 prompt 不够好。
- 不要换 Azure / OpenAI realtime 供应商——问题不在 STT/TTS。
- 不要现在就做多 session / 历史检索——会拖慢这一轮的体感验证。

按 A → B → C 推进，做完 A2 你应该已经能感到"工作台"的雏形，做完 C1 就基本达到 PRD 里"低打扰共思"的设想。

## 目标

将当前的 "Background Lane 直接写入 Locked Block" 模型升级为：选择模板后生成**Schema 驱动的 7 卡片画布 + Inline Pending Approval + Edit-as-Signal + Cross-Lane Shadow Sync**。Realtime Lane 严格只读且语音克制（≤20 字），慢模型只产出结构化补丁注入到固定容器内的"沙盒暂存区"，用户的 Accept/Delete/Edit 全部作为高权重信号反哺。

---

## 1. Schema 驱动的画布容器（新增）

新建 `src/lib/pipeline/thinkingTemplate.ts`：

- 新增一个选项供用户选择模板：定义 `ThinkingTemplate` 类型与默认模板 `productThinkingArtifact`，包含 7 个固定 slot：  
`current_question`  / `user journey` / `hypothesis` / `info & observation`/ `solution` / `open_questions` / `next_actions`
- 每个 slot 含 `id`, `title`, `prompt`（给 LLM 的填充提示）, `multi`（是否允许多条目）。
- 导出 `TEMPLATES: Record<string, ThinkingTemplate>`，预留未来扩展（Research / Writing / Decision 等）。

扩展 `src/lib/pipeline/types.ts` 中的 `BriefBlock`：

- 新增 `slotId?: string`（绑定到模板 slot）
- 新增 `status: 'committed' | 'pending_approval'`（默认 `committed`，旧数据兼容）
- 新增 `rationale?: string`（慢模型给出的简短依据，展示在 pending 卡片上）

数据库迁移：`brief_nodes` 表追加 `slot_id text`, `status text default 'committed'`, `rationale text`；对应 RLS 策略保持不变。

---

## 2. 画布渲染重构（`BriefDocument` / `BriefCanvas`）

将原本的扁平 block 列表改为 **按 slot 分组** 的 7 个稳定容器卡片：

```text
┌─ Current Question ──────────┐
│ committed item ...          │
│ ┌─ pending (dashed green) ─┐│
│ │ AI proposal              ││
│ │ rationale: ...           ││
│ │ [✓ Accept] [✕ Delete]    ││
│ └──────────────────────────┘│
└─────────────────────────────┘
```

- 每个 slot 卡片显示 `title`，其下按 `orderKey` 排列归属该 slot 的 blocks。
- `status === 'pending_approval'` 的 block 渲染为浅绿背景 + 虚线边框 + Accept/Delete 按钮；committed block 渲染为普通行内文本，仍可直接编辑。
- 空 slot 显示淡色 placeholder（来自 `slot.prompt`），不显示空白卡片骨架。
- 在慢模型流式输出（Streaming）未完成前，行内绿框应处于 Loading 或禁用点击状态，右上角的工具栏 `[✓ Accept] [✕ Delete]` 必须在流式生成完全结束后（`done: true`）再淡入显现，防止用户误触

新增 props/回调：`onAcceptPending(blockId)`, `onRejectPending(blockId)`, `onEditCommitted(blockId, body)`（已有的 edit 逻辑复用），并把这些操作通过新的 `signalBus` 转发（见第 5 节）。

---

## 3. Background Canvas Lane 重做

### 3.1 智能门控（Segment Sender）

新建 `src/lib/agent/segmentGate.ts`：

- 纯函数 `assessDensity(segment, recentTexts): { substantive: boolean; reason: string }`。
- 启发式 + 关键字过滤：丢弃 <8 字 / 纯填充词 / 与最近 segment 重复度高的片段。
- `onSegment` 中若 `substantive === false`，跳过慢模型调用（仍写入 transcript），并 `logIntervention({ decision: 'silent', reason })`。
- 当且仅当前端某个卡片处于激活编辑状态（Active Edit Mode）时，`segment sender` 必须暂停触发后台慢模型，优先保护用户的现场输入。

### 3.2 慢模型产出 Slot Patch

重写 `src/lib/agent/responseGenerator.functions.ts` 的输出契约：

- 输入新增：`template: ThinkingTemplate`、`snapshot` 按 slot 分组、`userSignals`（最近的 accept/reject/edit 事件，见 5.2）。
- 系统提示：明确告知模型 "只能产生对 7 个 slot 之一的增量补丁，且作为 pending_approval 注入；用户的拒绝/编辑是强信号，禁止重复被拒绝的提案"。
- 输出 schema：
  ```ts
  { emit: boolean;
    patch?: { slotId: SlotId; heading: string; body: string; rationale: string };
    insight?: string; // ≤120 字，供 Realtime 影子同步
  }
  ```
- 移除当前默认追加到末尾、`level: 3` 写死的逻辑。

### 3.3 注入为 Pending Block

`workbench.tsx` 中 `runBackgroundCanvas`：

- 当 `result.emit` 时，构造 block 时设置 `slotId = result.patch.slotId`, `status = 'pending_approval'`, `locked = false`, `lastEditedBy = 'ai'`, `rationale = result.patch.rationale`。
- 持久化到 DB（带 status='pending_approval'）。
- 不再自动 commit；等待用户 Accept。

---

## 4. Accept / Delete / Edit 行为

新增 server fn（或复用 `upsertBriefNode` + 状态字段）：

- `acceptPendingBlock(blockId)`：将 `status` 改为 `committed`，写一条 `user_signal` 日志。
- `rejectPendingBlock(blockId)`：从 doc 中移除（DB 行删除），写 `user_signal` 日志。
- `editCommittedBlock`（沿用现有 upsert 路径，但额外写 `user_signal` 日志）。

`signalBus`（见下节）将这些事件累积到 `recentSignals` 里，下一次慢模型调用时随 input 一起发送。

---

## 5. Cross-Lane Shadow Sync（影子同步回路）

### 5.1 `src/lib/agent/signalBus.ts`（新增轻量内存总线）

- 维护 `recentSignals: Array<{ type: 'accept' | 'reject' | 'edit' | 'pending_appear'; slotId; heading; ts }>`（环形，最近 12 条）。
- 暴露 `publish(signal)` 和 `snapshot()`，被 workbench 的 Accept/Reject/Edit handler 与 `runBackgroundCanvas`（产生 pending 时）调用。

### 5.2 Realtime 注入

- 任何 `publish` 调用后，提炼出一条极简文本（如 `"[background insight] Pending hypothesis in slot=pain: 用户怕踩坑"`），通过 `realtimeRef.current?.injectContext(...)` 异步推给 Realtime Session。
- Realtime system prompt 强化（在 `realtimeClient.ts`）：
  - 角色：头脑风暴合作伙伴
  - 硬约束："每次开口 ≤20 个字；右侧画布不是你的领地，禁止复述其内容；只在用户明显停顿或直接发问时才说话；优先识别用户的困惑，进行启发性追问或总结。"
  - 头脑风暴合作伙伴处理 `[background insight]`：仅作为"知识更新"吸收，不主动播报。
  - `injectContext` 的触发必须加上至少 3 秒的防抖（Debounce），只有当画布停止流式更新、且用户停止手动编辑 3 秒后，再将最终状态一次性反哺给语音 Agent。

---

## 6. 顶部导航 + 模板选择器

`workbench.tsx`：

- 在侧边栏顶部（或主区头部）加 `<select>` "思维模板"，默认 `Product Thinking Artifact`。
- 当前阶段只暴露默认模板（其他模板灰显 "Coming soon"），但读取/写入路径完全打通，所有 slot ID 由 `ThinkingTemplate` 驱动。
- 模板选择持久化到 `localStorage` (`murmur.template.${sessionId}`)，loadBrief 后用所选模板分组渲染。

---

## 7. 清理与简化

- `interventionPolicy.ts`：保留 `shouldEmitCanvas` 节流（4s 防抖），但语义改为"两次 pending 提案之间的最小间隔"。
- 移除当前 `responseGenerator` 中关于 `level: 3` / 直接追加末尾的所有遗留逻辑。
- `AgentPanel.tsx`：状态指示器保留（off / listening / thinking / speaking），不再渲染任何 suggestion 卡片。
- 日志 `interventionLog`：`decision` 扩展 `'pending'`（取代之前的 `'canvas'`），新增 `slotId` 列。

---

## 技术细节附录

**文件改动清单**

- 新增：`src/lib/pipeline/thinkingTemplate.ts`, `src/lib/agent/segmentGate.ts`, `src/lib/agent/signalBus.ts`
- 编辑：`src/lib/pipeline/types.ts`, `src/lib/pipeline/applyBriefPatch.ts`（处理 slotId/status）, `src/lib/brief.functions.ts`（增删字段 + accept/reject server fn）, `src/lib/agent/responseGenerator.functions.ts`, `src/lib/agent/realtimeClient.ts`, `src/lib/agent/interventionPolicy.ts`, `src/lib/agent/interventionLog.functions.ts`, `src/components/brief/BriefDocument.tsx`, `src/components/brief/BriefCanvas.tsx`, `src/components/agent/AgentPanel.tsx`, `src/routes/_authenticated/workbench.tsx`
- 迁移：新增 supabase migration 给 `brief_nodes` 加 `slot_id` / `status` / `rationale` 列 + 索引

**类型清洁**：所有新增字段在 `BriefBlock` 上都标注可选并提供默认值（DB 端 default `'committed'`），保证现有 session 加载不破坏。

**Out of scope**：STT/transcriptBuffer 不动；多模板（除默认）暂不实现。
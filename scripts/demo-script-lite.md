# Golden Script Lite：从零散语音到 Thinking Structure

## Demo 目标

这个 demo 用 2-3 分钟展示产品最核心的价值：

```text
零散语音想法
-> 可见的信息层级
-> 更聚焦的产品方向
-> 合并后的 demo positioning
-> 可执行的 Action Plan
```

这个 demo 不是为了证明 AI 能给出一个聪明答案，而是为了让观众看到：workspace 能把用户还没想清楚的思考过程变成可观察、可编辑、可推进的结构。

最终想让观众记住的一句话：

```text
这不是一个语音助手，也不是一个 transcript 工具。
它是一个能把未完成想法变成可操作结构的 Thinking Workspace。
```

---

## Demo Setup

用户正在重新思考自己的 Voice AI 产品应该往哪个方向演变。

这个 lite demo 不需要复杂背景材料。如果上传了 context files，它们只应该显示为画布左上角的 context indicator，不应该变成顶层内容。

第一屏应该直接进入 canvas。

---

# Round 1：捕捉零散想法

## 用户语音输入

```text
我现在想重新想一下，这个产品到底应该往哪个方向演变。

现在已经有很多 Voice AI 产品了。有些是语音助手，比如 ChatGPT Voice。有些是会议转写或者会议总结工具。还有一些是 voice note 工具。

但我感觉它们大多数还是停留在两种形态：一种是用户问，AI 回答；另一种是用户说完之后，AI 把语音整理成文字或者 summary。

我一直觉得真正的问题可能不在这里。因为当用户还在想、还没有想清楚的时候，他可能并不需要一个最终答案，也不只是需要 transcript。

他可能需要的是一个东西，能帮他看到自己刚才到底说了什么，哪些是 observation，哪些是 question，哪些可能会变成 product direction。

所以我现在想判断：这个产品到底应该是一个更好的 voice note，一个更好的 voice assistant，还是一个 voice-driven Thinking Workspace。
```

## Expected Canvas State

Canvas 应该生成一个紧凑的分层结构。它不应该一上来就生成完整答案。

```text
Focus
探索产品演变方向
```

```text
Observation
现有 Voice AI 产品大致包括 voice assistant、meeting transcription / summary、voice note。

它们多数关注问答，或者在用户说完之后整理语音内容。
```

```text
Context
用户正在探索一个还没有完全成型的产品方向。

关键场景不是 after-the-fact capture，而是 during-thinking。
```

```text
Analysis
当前张力：更好的 voice note / 更好的 voice assistant / voice-driven Thinking Workspace。

可能的核心缺口：用户还没想清楚时，需要持续的结构化支持。
```

```text
Action
下一步先看：用户在还没想清楚的时候，到底需要什么形式的支持。
```

## Agent 回复

```text
我先把这段话拆成信息层级，而不是直接总结成一段文字。

现在最重要的变化是：你的关注点从“说完之后的整理”，转到了“思考过程中的结构支持”。我建议下一步先看用户在想法还没成型时真正需要什么。
```

## 观众应该看到什么

```text
用户说的是一段比较散的语音想法。
系统把它拆成了 Observation、Context、Analysis、Action。
Action 不是最终产品答案，而是下一步思考动作。
```

## 测试检查点

```text
PASS：canvas 有 Focus、Observation、Context、Analysis、Action。
PASS：Action 是下一步思考动作，不是最终产品方案。
PASS：第一轮 canvas 没有把所有层级都填成最终结论。
FAIL：生成很多互相 disconnected 的卡片。
FAIL：直接跳到完整 action plan。
```

---

# Round 2：重新分配注意力，并更新已有结构

## 用户语音输入

```text
我觉得第三个方向更有意思，也就是 Thinking Workspace。

如果只是 voice note，它的价值还是偏记录。如果只是 voice assistant，它还是像用户问问题，AI 给回答。

但我想做的是一个在用户思考过程中一直维护结构的东西。比如我说了一个 observation，它就进入 observation；我说了一个困惑，它就变成 question；我说了一个可能方向，它就变成 hypothesis。

而且这个结构不是死的。它应该随着我继续说话不断变化。
```

## Expected Canvas Mutation

系统应该更新已有 canvas，尤其是 `Analysis` 和 `Action`。它不应该重新创建第二套平行结构。

```text
Analysis
Working direction：voice-driven Thinking Workspace。

Reason：voice note 主要保存说过什么，voice assistant 主要回答问题；这个产品的重点是在想法还没成型时，持续维护一个 evolving thinking structure。
```

```text
Action
围绕三个核心能力定义产品：
1. 把语音流拆成信息层级
2. 维护持续变化的 thinking state
3. 允许用户 edit、ask、merge、export 这个结构
```

可选 supporting card：

```text
Thinking Workspace
一个 voice-first workspace，帮助用户把未完成想法变成可见、可编辑的结构。
```

## Agent 回复

```text
这个选择让方向更清楚了。

我会更新 Analysis，而不是重新生成一段总结：这个产品不只是记录，也不只是回答，而是在用户思考还没成型时维护一个 thinking structure。
```

## 观众应该看到什么

```text
第二轮输入没有生成一个新的孤岛。
Canvas 通过更新已有层级继续演化。
用户可以看到自己的想法变得更清楚。
```

## 测试检查点

```text
PASS：Analysis 被更新为 Thinking Workspace 方向。
PASS：已有层级卡被更新，而不是被重复创建。
PASS：产品差异明确：不是 voice note，不是 voice assistant。
FAIL：远离核心结构生成一个新的 unrelated cluster。
```

---

# Round 3：Merge 成更清楚的 Demo Positioning

## 用户操作

Canvas 上现在有两个相关 card：

```text
Thinking Workspace
一个 voice-first workspace，帮助用户把未完成想法变成可见、可编辑的结构。
```

```text
Product Direction Brainstorm
第一个 use case 是帮助用户把模糊的产品想法变成结构和下一步行动。
```

用户选中这两个 card，然后点击 `Merge`。

如果 live demo 里手动选择不稳定，用户可以直接说：

```text
把 Thinking Workspace 和 Product Direction Brainstorm 合并成一个更清楚的 demo positioning。
```

## Expected Merge Result

```text
Demo Positioning
一个面向 product direction brainstorm 的 voice-first Thinking Workspace。

它帮助用户把还没成型的语音想法转成可见的信息层级，通过 canvas edit 继续 refine 结构，并最终 export 成 Action Plan。
```

## Agent 回复

```text
我把这两个节点合并成了一个更清楚的 positioning。

这里的抽象层级提高了：它不再只是一个产品类型，也不只是一个 use case，而是这个 demo 要证明的核心承诺。
```

## 观众应该看到什么

```text
Merge 不是简单拼接。
Merge 把两个局部想法提升成更成熟的表达。
Canvas 变得更适合展示和 export。
```

## 测试检查点

```text
PASS：Merge 减少或澄清了重复节点。
PASS：Merged card 比任意一个原始 card 都更成熟。
PASS：Merged card 同时包含产品类型、use case、用户价值。
FAIL：Merge 只是把两个 card body 粘在一起。
```

---

# Final：Export Action Plan

## 用户语音输入

```text
把现在这个结构导出成一个短的 Action Plan，我下一步可以真的照着做。
```

## Expected Export

```text
Action Plan：验证 Voice-First Thinking Workspace

1. Product Hypothesis
一个面向 product direction brainstorm 的 voice-first Thinking Workspace，可以帮助用户把未完成的语音想法变成可见、可编辑的结构。

2. Core Gap
Voice assistant 主要回答问题。Voice note 主要保存用户说过什么。Meeting summary 主要整理已经发生的讨论。
真正的缺口是：用户在想法还没成型时，缺少一种能持续支持 thinking-in-progress 的结构化工具。

3. First Use Case
优先验证 product direction brainstorm。
因为这个场景里的想法天然模糊、不完整、会变化，很适合展示从 voice flow 到 structured canvas 的过程。

4. Demo 必须展示的能力
- 零散语音想法变成 layered canvas
- Agent 把注意力重新分配到最重要的不确定性
- 后续输入会更新已有 canvas 结构
- Merge 把相关节点合并成更清楚的 positioning
- Export 把结构转成 Action Plan

5. 下一步
- 收紧 2-3 轮 demo script
- 让 canvas update-first，而不是 add-first
- 用 Realtime Agent 跑一次真实 demo
- 用 audit script 检查 layering、merge quality、action readiness
```

## Final Agent Line

```text
这最开始只是一个还没想清楚的想法。

现在它变成了一个可以编辑、可以解释、也可以继续行动的结构。
```

---

# Demo Pass Criteria

```text
1. 初始 capture 能生成信息层级。
2. 初始 canvas 不会一上来填满最终答案。
3. Agent 能把注意力指向最重要的下一个问题。
4. 第二轮输入会更新已有层级卡。
5. Merge 会生成更高层级的 positioning card。
6. Export 输出的是简短 Action Plan，不是普通 summary。
```

# Implementation Notes

这个 lite demo 优先追求稳定性，不追求功能全集。

保留：

```text
Capture
Attention reallocation
Update existing structure
Merge
Export
```

暂时弱化或 optional：

```text
Ask card
Research edge
multiple edge-label operations
long evidence chain
```

# Testing Targets

Real-run audit 最终应该接近：

```text
agentReplySource = realtime
trajectorySource = real canvas snapshot
initialLayering = true
notOverfilled = true
updateExistingStructure = true
mergeQuality = high
exportActionable = true
implementationHints = []
```

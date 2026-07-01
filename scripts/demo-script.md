# Murmur Demo Script and Test Plan

Goal: demo Murmur as a voice-first thinking canvas, not a transcript app. The user speaks, the canvas grows into structure, the Agent guides only when useful, research becomes small connected cards, and the final output can become an exploration brief.

Recommended demo length: 8-12 minutes.

## Persona

**Name:** Lin Chen / 林晨  
**Role:** Product designer building a compliance/safety workflow concept for small hardware companies.  
**Situation:** Lin is preparing for a mentor review. They have fuzzy ideas, need to brainstorm positioning, ask the Agent for guidance, research how large companies partner around compliance, then export an exploration brief.  
**Primary need:** Convert messy spoken thinking into a useful visual structure without manually cleaning notes.  
**Risk to test:** The system should not turn every small utterance into cards, should preserve the user's language, and should avoid long unstructured research cards.

## Demo Setup

- Open the workbench and create a fresh session.
- Start with an empty canvas.
- Keep the canvas visible.
- Use `Cmd/Ctrl+Shift+Space` for explicit canvas capture.
- Use `Talk with Agent` only when testing realtime conversation.
- For each scenario, say the transcript naturally with pauses.

## Success Metrics Summary

| Area | Success Metric | Target |
| --- | --- | --- |
| Language fidelity | Chinese input creates Chinese cards; English input creates English cards | 100% for titles and body text |
| Mind map trigger quality | Casual utterances like "Hi", "好的", "嗯" do not create cards | 0 false cards |
| Manual capture | `Cmd/Ctrl+Shift+Space` creates structured cards from one spoken thought | <= 5s after stop |
| Realtime Agent | Agent gives one short response, not duplicate replies | 1 response per user turn |
| Research | Research results become multiple small connected cards | 3-5 cards, no markdown artifacts |
| Canvas editing | Title is bold and separate; body wraps naturally; Enter works | Pass by manual edit |
| Export | PDF brief is structured, not raw transcript | Sections are readable and mentor-ready |

## Research-Style Evaluation Benchmarks

Use these after each scenario or after the full session. The goal is not only to verify that the UI rendered correctly, but to measure whether Murmur actually helped the user think.

The functional checks above are guardrails: language, trigger behavior, card count, edge quality, editing, and export must work well enough for the product to be usable. The real product benchmark is subjective and reflective: did the user feel their thinking became clearer, did they notice a new direction, and did the output become something they could discuss with another person?

### Benchmark Philosophy

For this product, success should be measured closer to creativity-support and sensemaking tools than to note-taking tools.

Do not define success as only:

- The canvas generated cards.
- The card count was correct.
- The layout looked neat.
- The transcript was accurate.

Define success as:

- The user can explain their idea more clearly after the session than before.
- The user discovers at least one new angle, missing question, risk, or next step.
- The user trusts that the canvas preserved their intent instead of rewriting the idea into something generic.
- The user feels lighter cognitive load: they can keep speaking without managing notes.
- The user would use the map or brief in a mentor conversation.

Score each item from 1 to 5:

1 = strongly disagree, 3 = neutral / partially true, 5 = strongly agree.

| Dimension | Rating Prompt | What Good Looks Like |
| --- | --- | --- |
| Thought clarity | "The canvas helped me understand my own thinking more clearly." | The user can explain the problem, options, and next step more easily after using the canvas |
| Structure quality | "The generated structure matched how I would organize the idea myself." | Cards reflect real conceptual roles: goal, question, option, risk, evidence, next step |
| Idea generation | "The system helped me notice at least one new angle, missing question, or possible direction." | User identifies a new path, scenario, risk, or research question after interacting with Agent/canvas |
| Cognitive load reduction | "I spent less effort remembering and organizing my thoughts." | User talks naturally without needing to manually rewrite everything afterward |
| Control / agency | "I felt in control of what entered the canvas." | User understands why cards appeared and can edit/delete/accept without feeling flooded |
| Trust | "The system did not invent or overstate my ideas." | Generated cards preserve intent and uncertainty; research is separated from user claims |
| Low interruption | "The Agent helped without derailing my thinking." | Agent speaks briefly, at useful moments, and does not duplicate or over-explain |
| Presentation readiness | "The final map/brief would help me discuss this with a mentor." | Output supports critique: clear focus, evidence, open questions, next actions |

### Pre/Post Reflection Method

Before using Murmur, ask the participant to speak for 60-90 seconds about the idea without AI help. Then ask two quick baseline questions:

| Moment | Question | Scoring |
| --- | --- | --- |
| Before | "How clear does this idea feel right now?" | 1-5 |
| Before | "How confident are you about what to explore next?" | 1-5 |

After using Murmur, ask the same two questions again, plus one open-ended question:

| Moment | Question | Scoring |
| --- | --- | --- |
| After | "How clear does this idea feel now?" | 1-5 |
| After | "How confident are you about what to explore next?" | 1-5 |
| After | "What changed in your understanding?" | Open response |

Useful benchmark signals:

| Metric | How To Calculate | Strong Signal |
| --- | --- | --- |
| Clarity lift | After clarity - before clarity | +1 or higher |
| Next-step confidence lift | After confidence - before confidence | +1 or higher |
| New insight count | Count user-mentioned new angles/questions/risks | At least 1 |
| Useful edit ratio | Useful generated cards / total generated cards | >= 70% |
| Presentation readiness | User would show the brief/map to mentor | >= 4/5 |

### Qualitative Coding

When reviewing a demo or user test recording, mark moments where the user says or does the following:

| Code | Evidence |
| --- | --- |
| Clarification | "Oh, this is actually two different users" or "Now I see the core problem" |
| New direction | User adds a new branch, scenario, risk, research question, or next step because of the canvas/Agent |
| Trust | User accepts generated cards with small edits instead of rewriting them |
| Loss of control | User asks why something appeared, deletes many cards, or says the AI is over-organizing |
| Interruption | User stops thinking to manage UI, repeated errors, duplicate Agent replies, or messy cards |

The best evidence is not that the user says "the UI worked." The best evidence is that the user points at the canvas and continues thinking from it.

### Primary Success Criteria

For a strong demo, aim for:

| Metric | Target |
| --- | --- |
| Clarity lift | +1 or higher |
| Next-step confidence lift | +1 or higher |
| New insight count | At least 1 per full session |
| Average subjective score | >= 4.0 / 5 |
| Thought clarity score | >= 4 / 5 |
| Idea generation score | >= 4 / 5 |
| Control / agency score | >= 4 / 5 |
| Low interruption score | >= 4 / 5 |

### Post-Task Interview Questions

Ask these after the demo/test. Let the user answer freely, then map responses back to the rubric.

- What did Murmur help you understand about your idea that was less clear before?
- Did the canvas create any card or relationship that felt genuinely useful?
- Did it suggest or surface any new direction, risk, or question?
- Which part felt noisy, redundant, or not faithful to what you meant?
- Did you feel in control of the canvas, or did it feel like the AI was taking over?
- Would you use the generated map or brief to present this idea to a mentor? Why or why not?

### Behavioral Signals To Observe

These are not strict pass/fail metrics, but useful qualitative evidence.

| Signal | Positive Evidence | Negative Evidence |
| --- | --- | --- |
| User edits less | User only tweaks titles/details | User rewrites most cards from scratch |
| User builds on AI output | User says "this gives me another idea" or adds branches | User deletes generated structure because it feels wrong |
| User references the map | User points to cards while explaining | User ignores the canvas and returns to raw speech |
| User trusts research cards | User uses findings to compare options | User sees markdown clutter or cannot tell what the evidence means |
| User feels flow | User keeps speaking naturally | User pauses to manage UI or correct noise repeatedly |

---

# Scenario 1: Chinese Manual Mind Map Capture

**Purpose:** Test explicit voice-to-canvas path and Chinese language fidelity.

**Action:** Press `Cmd/Ctrl+Shift+Space`, speak, press again to stop.

**Chinese Transcript:**

> 我现在想做的是一个面向小型硬件公司的合规助手。  
> 他们经常不知道产品进入大客户渠道之前，到底需要准备哪些安全认证、测试报告和供应商资料。  
> 我担心的问题是，如果只做成一个 checklist，它会很无聊；但如果能根据客户类型和行业自动推荐下一步材料，就会更有价值。

**Expected Canvas Behavior:**

- Cards are in Simplified Chinese.
- A central focus card appears, likely around "小型硬件公司的合规助手".
- Branches include customer pain, checklist risk, adaptive recommendation idea, next question.
- Edges use short categorical labels such as `PART_OF`, `RISK_OF`, `ENABLES`, `LEADS_TO`.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Language | All card title/body text is Chinese except terms like checklist |
| Structure | 3-5 useful cards, not a transcript paragraph |
| No over-splitting | No card for filler like "我现在想做的是" |
| Layout | Cards do not overlap and edges do not create odd downward protrusions |
| Subjective clarity | User rates "this helps me see the core idea and risks" >= 4/5 |
| Faithfulness | User says the map preserves their intended meaning without adding false claims |

---

# Scenario 2: English Manual Mind Map Capture

**Purpose:** Test English output and concept structuring.

**Action:** Press `Cmd/Ctrl+Shift+Space`, speak, press again to stop.

**English Transcript:**

> I am exploring a tool for small hardware companies that want to sell into enterprise channels.  
> The hard part is not just knowing the compliance requirements, but understanding what evidence a large buyer will ask for before they trust the vendor.  
> I want the product to help teams prepare the right safety docs, certifications, and supplier answers before the sales conversation starts.

**Expected Canvas Behavior:**

- Cards are in English.
- The map should identify enterprise sales readiness, compliance evidence, safety documentation, and supplier trust.
- The structure should be compact, not a long paragraph.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Language | All generated cards are English |
| Quality | At least one card captures "buyer trust/evidence" |
| Compactness | Max 5 cards unless the input is very dense |
| Editability | User can click a card, edit title/body, and press Enter in body for line breaks |
| Subjective usefulness | User can name one clearer distinction after seeing the map |

---

# Scenario 3: Casual Utterance Should Not Generate Mind Map

**Purpose:** Test trigger gate. The system should not create cards from shallow speech.

**Action:** Start `Talk with Agent`, say each line separately.

**Chinese Transcript:**

> 嗨。  
> 好的。  
> 嗯我想一下。  
> 先等一下。

**English Transcript:**

> Hi.  
> Okay.  
> Let me think.  
> Wait a second.

**Expected Canvas Behavior:**

- Agent may respond briefly, but the canvas should not create new mind map cards for these lines.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| False positive card creation | 0 cards generated |
| Agent response | No duplicate reply to a single "Hi" |
| Transcript | User and Agent lines can still appear in transcript/history |

---

# Scenario 4: Realtime Agent Guides, User Thought Enters Canvas

**Purpose:** Test realtime conversation path. User's substantive thought should become canvas structure; Agent should stay concise.

**Action:** Start `Talk with Agent`, speak naturally.

**Chinese Transcript:**

> 我现在卡住的地方是目标用户。  
> 一种可能是直接卖给小硬件公司，帮他们准备进入大客户采购流程的材料。  
> 另一种可能是卖给大公司采购团队，让他们更快判断供应商是不是合规。  
> 你觉得我应该先验证哪一边？

**English Transcript:**

> I am stuck on the target user.  
> One option is selling to small hardware companies and helping them prepare for enterprise procurement.  
> Another option is selling to enterprise procurement teams so they can evaluate supplier compliance faster.  
> Which side should I validate first?

**Expected Behavior:**

- Agent gives one short guiding response.
- User's substantive turn creates or updates mind map cards.
- The map distinguishes two possible users and the validation question.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Agent brevity | 1-2 short sentences |
| Duplicate response | No second Agent reply for the same turn |
| Canvas structure | Cards include small hardware companies, enterprise procurement, validation question |
| Language | Cards match the language of the user turn |
| Decision support | User rates "the Agent helped me decide what to validate next" >= 4/5 |
| New angle | User can identify at least one useful framing or tradeoff surfaced by the Agent/canvas |

---

# Scenario 5: Command Agent To Write To Canvas

**Purpose:** Test explicit Agent canvas-writing commands.

**Action:** Select a node about target user if possible, then talk to Agent.

**Chinese Transcript:**

> 在这个目标用户节点下面，帮我发散三个使用场景。  
> 一个是准备进入大客户采购，一个是补齐安全认证材料，一个是回答采购团队的问题。  
> 请直接写到画布上。

**English Transcript:**

> Under this target user node, expand three use cases.  
> One is preparing for enterprise procurement, one is filling safety certification gaps, and one is answering procurement team questions.  
> Please write them directly onto the canvas.

**Expected Behavior:**

- Agent should not only talk. It should propose canvas ops.
- Exactly or approximately 3 new cards appear.
- Cards connect to the selected/current target node.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Command compliance | 3 use-case cards are created |
| Edge quality | Edges use categorical labels, not full sentences |
| Content fidelity | The three scenarios match the user's requested scenarios |
| No extra clutter | No unrelated cards are added |
| User control | User says the Agent wrote what they asked for, not more than they asked for |

---

# Scenario 6: Research Splits Into Connected Cards

**Purpose:** Test research output shape. It should not become one long markdown card.

**Action:** Ask Agent to research.

**Chinese Transcript:**

> 帮我查一下，现在公司和大型企业合作推广合规或者安全相关产品的时候，常见的合作方式有哪些。  
> 我想知道有没有战略合作、行业协会合作、渠道伙伴或者采购合规项目这些模式。

**English Transcript:**

> Help me research current common practices for partnering with large companies to promote compliance or safety-related products.  
> I want to know whether strategic partnerships, industry associations, channel partners, or procurement compliance programs are common patterns.

**Expected Behavior:**

- Agent acknowledges briefly and triggers research.
- Brief can contain the fuller research result.
- Canvas should create several small research cards connected to the current question/focus node.
- Markdown artifacts should not show in card text.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Research trigger | A research task starts |
| Canvas shape | 3-5 small cards, not one giant card |
| Connection | Research cards connect to the relevant question/focus node |
| Markdown cleanup | No visible `**bold**`, `[link](url)`, or long raw URLs inside cards |
| Source handling | Sources can remain in brief, not crowded into canvas cards |
| Insight value | User can name one research-backed pattern they did not have clearly before |
| Evidence clarity | User rates "the research cards helped me compare options" >= 4/5 |

---

# Scenario 7: Card Editing UX

**Purpose:** Test title/body editing inside a card.

**Action:** Click any generated idea card and edit it.

**Manual Test Text:**

Title:

```text
Enterprise procurement readiness
```

Body:

```text
Prepare safety docs before sales calls.
Map missing certifications.
Answer buyer compliance questions.
```

**Expected Behavior:**

- Title is bold and visually separate.
- Title occupies the first line and wraps only after using full card width.
- Body is normal weight.
- Pressing Enter in title moves/focuses into body.
- Pressing Enter in body creates a new line.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Title wrapping | Does not wrap after every character |
| Body wrapping | Long body text wraps naturally inside the card |
| Enter behavior | Title Enter moves to body; body Enter inserts newline |
| Visual hierarchy | Title is clearly bold; body is regular weight |

---

# Scenario 8: Export Exploration Brief

**Purpose:** Test final output for mentor presentation.

**Action:** After scenarios 1, 4, and 6, export PDF.

**Expected PDF Sections:**

- Exploration focus
- Current understanding
- User/customer segments
- Promising directions
- Research-backed patterns
- Open questions
- Suggested next steps

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Not raw transcript | PDF is structured, not a chat log |
| Language | Uses the dominant session language or preserves mixed context gracefully |
| Research inclusion | Research appears as synthesized insight, not pasted raw markdown |
| Mentor usefulness | A mentor can understand what was explored and what needs feedback |
| Presentation readiness | User rates "I would show this to a mentor" >= 4/5 |

---

# End-To-End Demo Flow

Use this order for a polished demo:

1. 30s intro: "Murmur turns speaking into a living thinking canvas."
2. Scenario 1 Chinese manual capture.
3. Scenario 3 quick false-positive test: say "Hi" and show no card is created.
4. Scenario 4 realtime Agent guidance.
5. Scenario 5 command Agent to write three use cases.
6. Scenario 6 research, then show multiple connected research cards.
7. Scenario 7 edit one card live.
8. Scenario 8 export PDF for mentor.

## Closing Line

"The point is not transcription. The point is that messy spoken thinking becomes a structured artifact: a map I can edit, research I can trust, and a brief I can present."

## Troubleshooting Notes

| Problem | Demo Recovery |
| --- | --- |
| Azure recognizes Chinese as English | Repeat the line more clearly; current recognizer defaults to `zh-CN` before `en-US` |
| Agent gives duplicate reply | Stop and restart Talk with Agent; Realtime has connection lock and manual prompt is disabled |
| Research is slow | Say: "It is doing actual web research; the brief will update when sources return" |
| Too many cards | Explain the gate is tuned for substantive thoughts; use manual capture for intentional structure |
| Layout looks crowded | Drag the parent node; edges and child cards follow spatially through node positioning |

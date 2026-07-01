# Murmur Presentation Outline (Value Narrative for Mentor Review)

> This outline sits on top of the demo script below. It is the story you tell; the
> scenarios are what you show. Audience: a mentor critiquing the product. Spine:
> **positioning → problem → solution → value**, mapped to the PRD (v1, 2026-06-05)
> and to the concrete demo scenarios in this file.

## 0. One-line positioning (open with this)

A **Voice-first AI co-thinking workbench**: you speak scattered thoughts, the system
turns them into a **live editable structure in real time**, an Agent **thinks together
with you** at your pace, and you leave with a **clear problem definition and a next
validation step** — not a chat log.

> PRD anchor: §01 Product Positioning ("一句话总结"). Three pillars: *Think Out Loud ·
> See Your Ideas Evolve · Know What to Do Next*.

## 1. The problem (why this exists)

Say it as one core problem with two consequences — this is exactly the PRD problem tree.

- **Core:** When you explore a not-yet-formed idea, thoughts arrive fast and keep
  changing. Existing tools either just store raw content, or force you to organize the
  question *before* talking to AI. **So thinking stays scattered and breaks.**
- **Consequence 1 — Co-thinking gap:** Traditional Voice Agents are turn-based. They
  wait passively, or speak too early while you are still diverging — and interrupt.
  *You do not need more answers; you need timely, low-interruption co-thinking.*
- **Consequence 2 — Action gap:** After the conversation you still re-read a transcript
  and manually extract problems, assumptions, next steps. *You do not need a chat log;
  you need an Exploration Brief you can keep working on.*

> PRD anchor: §2.3 核心问题结构 (core + 衍生问题 01/02). Competitor table §2.5: everyone
> solves record / summarize / visualize / chat — nobody connects **real-time voice
> co-thinking + dynamic structure + action** into one flow.

## 2. The value points (the heart of the pitch)

Each value point = one PRD pillar → the specific claim → the demo scenario that proves
it → the one-line you actually say.

### V1 — Structure: speaking and organizing stop being two separate steps

- **Claim (PRD §3.1 Stage 1):** Not appending transcript — messy speech is placed into
  the right slot (problem, evidence, assumptions, directions, trade-offs, open
  questions) as a **live, editable** Live Brief.
- **Proof:** Scenario 1 (Chinese capture) + Scenario 7 (edit a card live).
- **Say:** "I don't organize my language first. I just talk, and it grows a structure I
  can immediately edit — I keep final control, the AI keeps organizing."

### V2 — Co-thinking: the Agent follows my thinking, it doesn't interrupt it

- **Claim (PRD §3.2 Stage 2):** Default is silent structuring. The Agent speaks only
  when it helps — and when asked to lay things out, it **narrates the structure** instead
  of throwing the question back. This is the *intervention ladder* (silent → light text
  → short voice).
- **Proof:** Scenario 4 (walkthrough) — **this is the money shot** — plus Scenario 3
  (greetings/thanks create nothing, no double replies).
- **Say:** "Watch — I say 'walk me through my idea', and it lays out my thinking:
  core goal, hardest part, directions, next step. It does **not** ask me 'what do you
  want to tackle?'. And when I'm just thinking, it stays quiet."

### V3 — See Your Ideas Evolve: the canvas grows *while* the Agent speaks

- **Claim (PRD pillar 2 + §2.5 output form "实时看板 Live Brief"):** As the Agent
  narrates, each segment grows a matching card. The idea is being organized *with* me,
  visibly, in real time — the differentiator no competitor column has.
- **Proof:** Scenario 4 canvas behavior (new cards appear during the walkthrough) +
  Scenario 5 (precise, commanded canvas writes under a selected node).
- **Say:** "Every point it makes lands as a card on the canvas. My thinking becomes
  something I can see, move, and keep."

### V4 — Faithful & in control: it preserves my intent, I am not flooded

- **Claim (PRD §2.4 用户洞察):** Users reject "AI 味太重". Output stays editable, keeps
  uncertainty, does not overclaim. Filler does not become cards.
- **Proof:** Scenario 3 (no false cards) + Scenario 7 (edit) + Scenario 5 (no unrelated
  cards).
- **Say:** "It keeps my words and my uncertainty. I can delete or reshape anything — it
  organizes, but it doesn't take over."

### V5 — Action: the session ends as a brief I can present, not a recording

- **Claim (PRD §3.3 Stage 3):** The output is an Exploration Brief — problem hypothesis,
  interaction model, evidence, open questions, next validation steps — a starting point
  for the *next* step, not a dead deliverable.
- **Proof:** Scenario 6 (research → connected evidence cards) + Scenario 8 (export brief).
- **Say:** "I walk away with a structured brief I can bring straight to you — not a
  transcript I still have to clean up."

## 3. Differentiation (if asked "how is this different from ChatGPT Voice / Otter / Miro?")

Three lines, straight from the PRD §2.5 table:

1. **Interaction:** they are turn-based and interrupt; Murmur is **continuous streaming
   input + smart interruption** — quiet when it should be, co-thinking when it matters.
2. **Output:** they leave only chat history / raw transcript; Murmur precipitates a
   **live Live Brief board**.
3. **Co-thinking depth:** they wait for prompts; Murmur **proactively** helps articulate
   the idea and structures it onto the canvas as it speaks.

## 4. How I'd evaluate it (pre-empt the "does it actually work?" question)

The real benchmark is not "is the diagram correct" — it's **"do I understand my own idea
better after using it?"** Concretely: clarity lift `+1`, next-step confidence lift `+1`,
at least one new insight (see *Research-Style Evaluation Benchmarks* below).

## 5. Two honest caveats (say them before you're asked — it reads as maturity)

- **"Real-time" ≠ per-word animation.** Canvas growth is async per-segment LLM calls, so
  there's a short delay. It's structuring, not a typewriter effect.
- **The walkthrough is on-demand.** The Agent narrates only when I explicitly ask
  ("walk me through / 帮我梳理"). Default is low-interruption — that's the design, not a
  bug. State this up front so silence reads as intentional.

## 6. Talk track ↔ scenario map (quick reference during the live run)

| Beat | Value point | PRD | Scenario |
| --- | --- | --- | --- |
| Intro / framing | Positioning | §01 | Framing line |
| Speak a messy idea → structure | V1 Structure | §3.1 | Scenario 1 |
| Filler creates nothing | V4 Control | §2.4 | Scenario 3 |
| "Walk me through" → narration + canvas grows | V2 Co-thinking + V3 Evolve | §3.2 | **Scenario 4** |
| Command precise canvas writes | V3 Evolve | §3.2 | Scenario 5 |
| Research → evidence cards | V5 Action | §3.3 | Scenario 6 |
| Edit a card live | V4 Control | §2.4 | Scenario 7 |
| Export exploration brief | V5 Action | §3.3 | Scenario 8 |

---

# Murmur Demo Script and Test Plan

Goal: demo Murmur as a voice-first thinking canvas for clarifying an early product idea. The demo should show that messy spoken thinking can become a live canvas, the realtime Agent can guide attention without taking over, research can become connected evidence cards, and the final output can become an exploration brief for a mentor.

Recommended demo length: 8-10 minutes.

## Demo Persona

**Name:** Xiao / Product design student  
**Context:** Xiao is preparing to present Murmur, an AI voice brainstorming canvas, to a mentor. The product direction is still evolving. Xiao needs to explain what problem Murmur solves, how voice + canvas + realtime Agent work together, and how to evaluate whether it actually helps people think.  
**Primary need:** Think aloud naturally and let the system turn scattered thoughts into a structure that can be discussed.  
**Core tension:** Murmur should not be just a transcript app or a chat app. It should help users notice what matters, organize fuzzy ideas, and create a shareable thinking artifact.

## Demo Setup

- Open a fresh Murmur session.
- Start with an empty canvas.
- Keep the canvas visible during the whole demo.
- Use `Cmd/Ctrl+Shift+Space` for intentional canvas capture.
- Use `Talk with Agent` when testing realtime guidance.
- Speak naturally. Do not read like a polished pitch.

## One-Sentence Demo Framing

"I am going to use Murmur to think through Murmur itself: what it is, why voice matters, how the Agent should guide attention, and whether the final canvas is useful enough to discuss with a mentor."

## Success Metrics Summary

| Area | Success Metric | Target |
| --- | --- | --- |
| Language fidelity | Chinese input creates Chinese cards; English input creates English cards | 100% for title/body |
| Thought capture | Messy speech becomes compact cards, not raw transcript | 3-5 useful cards |
| Trigger quality | Greetings, thanks, and filler do not create cards | 0 false cards |
| Agent guidance | Agent gives useful structure, not just another question | User can name one clearer next step |
| Canvas evolution | Agent walkthrough can create/update canvas structure | Visible new cards or connections |
| Research | Research becomes several small connected evidence cards | 3-5 cards, no markdown clutter |
| Export | PDF is an exploration brief, not a chat log | Mentor-ready sections |

## Research-Style Evaluation Benchmarks

The functional checks above are guardrails. The real benchmark is whether Murmur helps the user think better.

Score each item from 1 to 5:

1 = strongly disagree, 3 = partially true, 5 = strongly agree.

| Dimension | Rating Prompt | What Good Looks Like |
| --- | --- | --- |
| Thought clarity | "The canvas helped me understand my idea more clearly." | User can explain problem, mechanism, and next step more easily |
| Idea generation | "The system helped me notice a new angle, risk, or question." | User identifies at least one new direction after using Agent/canvas |
| Attention guidance | "The Agent helped me focus on what mattered next." | Agent points to a high-leverage issue instead of asking generic questions |
| Control / agency | "I felt in control of what entered the canvas." | User can edit/delete/accept without feeling flooded |
| Trust | "The system preserved my intent without inventing too much." | Cards keep uncertainty and do not overclaim |
| Low interruption | "The Agent helped without derailing my flow." | No duplicate replies, no excessive filler, no awkward turn-taking |
| Presentation readiness | "I would use this map or brief with a mentor." | Output supports critique and discussion |

### Pre/Post Reflection

Before the demo, ask:

| Question | Score |
| --- | --- |
| How clear does the Murmur product direction feel right now? | 1-5 |
| How confident are you about what to discuss with a mentor next? | 1-5 |

After the demo, ask the same two questions again, then ask:

| Question | Evidence |
| --- | --- |
| What became clearer? | User names a clearer product frame or interaction model |
| What new idea or concern appeared? | User names a new direction, risk, or missing validation question |
| What would you show to a mentor? | User points to map/brief content |

Primary target: clarity lift `+1`, next-step confidence lift `+1`, at least one new insight.

---

# Scenario 1: Chinese Manual Capture, Product Core

**Purpose:** Test whether intentional voice capture can turn Xiao's real product thinking into a useful Chinese canvas structure.

**Action:** Press `Cmd/Ctrl+Shift+Space`, speak, press again to stop.

**Chinese Transcript:**

> 我现在想做的其实不是一个普通的语音转文字工具。  
> 我想做的是一个可以陪用户一边说一边思考的画布。  
> 用户说出来的想法可能很散，但是系统应该帮他变成一些可以看见、可以移动、可以继续发展的结构。  
> 我最在意的是，它能不能真的帮助用户把思路变清楚，而不是只是生成一些看起来漂亮的卡片。

**Expected Canvas Behavior:**

- Cards are in Simplified Chinese.
- Central focus is around "语音思考画布" or "陪用户思考的画布".
- Branches include: not transcription, visible structure, editable canvas, clarity as value.
- No filler card like "我现在想做的其实是".

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Language | All main cards are Chinese |
| Structure | 3-5 cards, not one transcript paragraph |
| Faithfulness | Preserves "not transcript app" and "clarify thinking" |
| Visual clarity | Cards are not crowded; edge labels are categorical |
| Subjective clarity | User rates clarity help >= 4/5 |

---

# Scenario 2: English Manual Capture, Product Pitch

**Purpose:** Test English language fidelity and whether Murmur can structure a rough product pitch.

**Action:** Press `Cmd/Ctrl+Shift+Space`, speak, press again to stop.

**English Transcript:**

> Murmur is a voice-first thinking canvas.  
> The user should be able to talk naturally, and the canvas should grow with their thinking.  
> The realtime Agent should not behave like a chatbot that keeps asking questions.  
> It should help reallocate the user's attention: what is unclear, what is missing, and what might be worth exploring next.

**Expected Canvas Behavior:**

- Cards are in English.
- Cards identify voice-first canvas, live canvas growth, Agent role, attention guidance.
- The structure should be compact.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Language | All generated title/body text is English |
| Quality | Captures "reallocate attention" as a core value |
| Compactness | Max 5 cards |
| Editability | User can edit title/body naturally |

---

# Scenario 3: Casual Utterance Should Not Create Cards

**Purpose:** Test that the canvas does not react to shallow conversation.

**Action:** Start `Talk with Agent`, say each line separately.

**Transcript:**

> Hi.  
> What's your name?  
> 嗯，我想一下。  
> Thank you.

**Expected Behavior:**

- Agent can answer briefly.
- No mind map cards are created for greeting, name question, filler, or thanks.
- No duplicate Agent reply.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| False positive card creation | 0 cards |
| Agent response | 1 response per user turn |
| Flow | User does not need to clean up useless cards |

---

# Scenario 4: Realtime Agent Walkthrough

**Purpose:** Test whether the Agent can say more when asked for a walkthrough and make the canvas evolve while speaking.

**Action:** Start `Talk with Agent`, then ask for help.

**Chinese Transcript:**

> 你可以帮我把我现在这个产品想法整体走一遍吗？  
> 我现在有点混乱，我知道它和语音、画布、Agent 都有关，但是我不知道应该怎么讲清楚它的核心价值。

**English Transcript:**

> Can you walk me through the whole picture of my product idea right now?  
> I know it involves voice, canvas, and an Agent, but I am not sure how to explain the core value clearly.

**Expected Agent Behavior:**

- Agent gives a 3-5 sentence walkthrough, not just one tiny reply.
- Agent should not end by simply throwing the question back to the user.
- Agent frames the idea as: voice input, canvas external memory, Agent attention guidance, mentor-ready artifact.
- Agent may create compact canvas cards while speaking.

**Expected Canvas Behavior:**

- New cards or updates appear around the product structure.
- Possible cards: "Voice-first capture", "Living canvas", "Attention guidance", "Exploration brief", "Open validation question".
- Connections are simple and readable.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Walkthrough quality | Agent gives a useful structure, not generic encouragement |
| Canvas evolution | At least 3 useful cards or updates appear |
| No handoff loop | Agent does not end with only "what do you want to tackle?" |
| Attention guidance | User can name what matters next |
| Subjective value | User rates Agent guidance >= 4/5 |

---

# Scenario 5: Ask Agent To Expand A Selected Node

**Purpose:** Test precise Agent canvas writing.

**Action:** Select a node such as "Attention guidance" or "Agent role", then talk to Agent.

**Chinese Transcript:**

> 在这个 Agent role 下面，帮我发散三个它应该做的事情。  
> 一个是指出我没有讲清楚的地方，一个是提醒我遗漏了什么，一个是帮我把下一步验证问题写出来。  
> 直接写到画布上。

**English Transcript:**

> Under the Agent role node, expand three things it should do.  
> One is pointing out what is unclear, one is noticing what I missed, and one is writing the next validation question.  
> Put them directly on the canvas.

**Expected Behavior:**

- Agent briefly confirms and writes to canvas.
- Exactly or approximately 3 child cards appear.
- Cards stay connected to the selected/current Agent role node.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Command compliance | 3 cards are created |
| Fidelity | The three cards match the requested functions |
| Edge quality | Edges use categorical labels, not explanations |
| Control | No unrelated cards are added |

---

# Scenario 6: Research For Product Positioning

**Purpose:** Test research as evidence cards, not a long markdown blob.

**Action:** Ask Agent to research.

**Chinese Transcript:**

> 帮我查一下，voice note、mind mapping、AI brainstorming、creativity support tools 这些方向里，大家通常怎么评估一个工具有没有真的帮助用户思考？  
> 我不只是想看功能有没有跑通，我想知道有没有主观的评价方式，比如思路更清楚了，产生了新想法，认知负担变低了。

**English Transcript:**

> Help me research how voice notes, mind mapping, AI brainstorming, and creativity support tools are usually evaluated.  
> I do not only want functional metrics. I want subjective evaluation methods, like whether users feel clearer, generate new ideas, or reduce cognitive load.

**Expected Behavior:**

- Agent acknowledges briefly and triggers research.
- Canvas receives several small connected research/evidence cards.
- Brief can keep the fuller source-backed synthesis.
- Markdown artifacts are removed from cards.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Research trigger | Research task starts |
| Canvas shape | 3-5 small cards, not one giant card |
| Relevance | Cards mention subjective evaluation, clarity, creativity, cognitive load, or sensemaking |
| Source handling | Sources stay in brief, not crowded into cards |
| Insight value | User can use one metric in mentor discussion |

---

# Scenario 7: Edit The Canvas Live

**Purpose:** Show the canvas is editable, not just generated output.

**Action:** Click a generated card and edit it.

**Manual Test Text:**

Title:

```text
Attention guidance
```

Body:

```text
Notice what is unclear.
Surface missing assumptions.
Suggest the next validation question.
```

**Expected Behavior:**

- Title is bold and occupies the first line.
- Body is normal weight.
- Body wraps naturally.
- Pressing Enter in body creates a line break.

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Title wrapping | Does not wrap after every character |
| Body wrapping | Long text wraps naturally |
| Enter behavior | Enter creates body line breaks |
| Feeling | User feels they can shape the AI output |

---

# Scenario 8: Export Exploration Brief For Mentor

**Purpose:** Test whether the final output helps mentor presentation.

**Action:** After scenarios 1, 4, and 6, export PDF.

**Expected PDF Sections:**

- Exploration focus
- Current product hypothesis
- Core interaction model
- Agent role
- Evidence / research-backed evaluation metrics
- Open questions
- Suggested next validation steps

**Success Metrics:**

| Metric | Pass Criteria |
| --- | --- |
| Not raw transcript | PDF is structured, not a chat log |
| Mentor usefulness | A mentor can understand the product direction |
| Evaluation clarity | Brief includes how to judge whether Murmur works |
| Presentation readiness | User rates "I would show this to a mentor" >= 4/5 |

---

# End-To-End Demo Flow

Use this order for a polished live demo:

1. 20s intro: "I am going to use Murmur to think through Murmur itself."
2. Scenario 1: Chinese manual capture of the product core.
3. Scenario 3: Say "Hi" / "Thank you" to show no useless cards appear.
4. Scenario 4: Ask Agent for a walkthrough and show canvas evolving.
5. Scenario 5: Select Agent role and ask for three concrete functions.
6. Scenario 6: Research subjective evaluation metrics.
7. Scenario 7: Edit one generated card live.
8. Scenario 8: Export the exploration brief.

## Mentor Presentation Script

"The value I am testing is not whether Murmur can transcribe speech. The value is whether speaking can become a structured thinking artifact. In this demo, I use Murmur to think through Murmur itself: first I speak a messy idea, then the canvas turns it into movable structure, then the realtime Agent helps me notice what deserves attention next, and finally the session becomes an exploration brief I can discuss with a mentor."

## Closing Line

"The success metric is not just whether the diagram is correct. It is whether I understand my own idea better after using it."

## Troubleshooting Notes

| Problem | Demo Recovery |
| --- | --- |
| Chinese recognized as English | Repeat the line clearly; explain language fidelity is an active test |
| Agent asks too many questions | Say: "Walk me through it and write the structure to the canvas" |
| Too many cards | Delete one live to show user control |
| Research is slow | Explain research is asynchronous and the brief updates when sources return |
| Layout feels crowded | Drag the parent node or use this as a point about layout refinement |

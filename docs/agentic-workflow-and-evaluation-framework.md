# Agentic Workflow and Evaluation Framework for Voice-First Brainstorming

## Purpose

This document records the technical methodology behind Murmur: a voice-first brainstorming canvas where a user can think aloud with a realtime agent while the canvas gradually organizes the conversation into visible structure.

The goal is not only to build a working product, but also to understand how an AI system can participate in early-stage thinking without over-summarizing, over-generating, or taking control away from the user.

## Core Research Question

How can an agentic system help a user turn messy spoken thoughts into clearer, more actionable thinking while preserving the user's intent, uncertainty, and language?

This breaks down into several sub-questions:

- How should the system decide when a thought is worth writing to the canvas?
- How should messy speech be transformed into nodes and edges without losing meaning?
- How much freedom should the AI have when choosing diagram structure?
- How can multiple agents collaborate without creating duplicate, noisy, or conflicting output?
- How should we evaluate whether the user was genuinely helped?

## Working Hypothesis

The agent should not directly generate the final diagram in one step.

Instead, the system should separate the work into stages:

1. Understand the user turn.
2. Plan the structure.
3. Generate constrained canvas commands.
4. Validate the commands against schema rules.
5. Place nodes using layout constraints.
6. Let user edits become feedback.

This staged workflow should produce clearer diagrams than a single prompt that asks the model to summarize and draw at the same time.

## Agent Roles

### Realtime Conversation Agent

Role: Stay in conversation with the user.

Responsibilities:

- Give short, useful responses.
- Ask clarifying or attention-shifting questions.
- Avoid long summaries when the canvas can carry structure.
- React to explicit commands such as research, write, expand, or connect.

Design principle:

The realtime agent should guide the user's attention, not narrate every internal step.

### Canvas Structuring Agent

Role: Convert messy voice turns into canvas cards and relationships.

Responsibilities:

- Preserve the user's dominant language.
- Preserve concrete nouns, product terms, uncertainty, and tradeoffs.
- Generate a small number of high-value cards.
- Use constrained card roles and edge relations.
- Avoid splitting one feature flow into many redundant cards.

Current constraints:

- Card roles: `FOCUS`, `QUESTION`, `OPTION`, `EVIDENCE`, `RISK`, `ASSUMPTION`, `NEXT_STEP`.
- Card granularity: `FEATURE`, `QUESTION`, `RISK`, `NEXT_STEP`, `EVIDENCE`, `ASSUMPTION`.
- Edge relations: `SUPPORTS`, `CHALLENGES`, `LEADS_TO`, `DEPENDS_ON`, `ANSWERS`, `RISK_OF`.

Design principle:

The model should split by thinking role, not by sentence order.

### Quiet Insight Agent

Role: Observe the canvas in the background and surface useful reminders.

Responsibilities:

- Detect unresolved questions.
- Notice missing assumptions, risks, or next steps.
- Suggest a card only when it adds real value.
- Avoid interrupting the user's flow.

Design principle:

The quiet layer should reallocate attention, not compete with the realtime agent.

### Research Agent

Role: Fetch and synthesize external context when the user asks for research.

Responsibilities:

- Break research into small findings.
- Attach findings to relevant existing nodes.
- Remove raw markdown artifacts.
- Avoid producing one long prose block.

Design principle:

Research output should become structured evidence that can enter the canvas, not a pasted article summary.

### Critic / Evaluation Agent

Role: Check whether a proposed canvas update is good enough before or after rendering.

Responsibilities:

- Detect over-splitting.
- Detect long or vague edge labels.
- Detect language mismatch.
- Detect hallucinated claims.
- Detect layout risk such as long-distance edges or isolated nodes.

Design principle:

The critic should enforce quality gates that prompts alone cannot reliably enforce.

## Proposed Workflow

```text
User messy speech
→ Speech recognition
→ Thought turn detection
→ Intent and density gating
→ Diagram planning
→ Canvas command generation
→ Schema validation
→ Layout constraints
→ Canvas rendering
→ User edit feedback
```

## Diagram Planning Step

Before drawing, the AI should produce an intermediate planning object:

```text
1. Core problem
2. Main uncertainty
3. Emerging thesis
4. Key supporting points
5. Competing options
6. Relationship type
7. Recommended visual format
8. Diagram nodes and edges
9. What to omit or downplay
10. Suggested next step
```

This makes it possible to diagnose whether a bad diagram failed because of transcript understanding, structure extraction, visual format selection, node wording, edge relation, or final layout.

## Candidate Visual Formats

Different thoughts may require different structures:

- Decision Map: useful when the user is comparing multiple options.
- Layered Architecture: useful when the user is describing a system or product pipeline.
- Problem → Insight → Next Step: useful when the user needs a compact, actionable thinking summary.
- Risk / Assumption Map: useful when the idea depends on uncertain claims.
- Evidence Map: useful when research findings need to support or challenge claims.

## Evaluation Framework

The product should not only be evaluated by whether the diagram looks correct. The deeper question is whether it improves the user's thinking.

### Subjective Measures

- Fidelity: Does the output preserve the user's original intent?
- Clarity: Does the output make the thought easier to understand?
- Insightfulness: Does the output reveal a new idea, gap, risk, or connection?
- Actionability: Does the user know what to do next?
- Cognitive Load: Does the canvas reduce mental effort instead of adding noise?

### Human Evaluation Questions

Ask 3-5 users to look at an AI-generated diagram and answer:

1. What do you think the user's core problem is?
2. What is still unclear or unresolved?
3. What should the user do next?
4. Where is the diagram misleading?
5. How would you improve the diagram?

If viewers can accurately restate the user's intent and identify a useful next step, the diagram is likely effective.

### Behavioral Feedback Signals

User edits can become implicit quality signals:

- Deleted card: low-value, redundant, or wrong node.
- Edited title: wording or abstraction level was off.
- Edited body: content was incomplete or not faithful enough.
- Dragged nodes closer: relationship was stronger than the layout implied.
- Disconnected edge: relationship was wrong or misleading.
- Expanded a card: the idea was valuable and worth developing.

## Benchmark Plan

Build a small, high-quality benchmark before considering fine-tuning.

Each messy brainstorm transcript should be annotated with:

- Core problem
- Core uncertainty
- Key claims
- Competing options
- Relationship type
- Recommended visual type
- Diagram nodes and edges
- What to omit
- Next step

Start with 5 golden cases, then expand to 20 cases once the annotation format feels stable.

## Current Technical Learnings

### Prompt-only control is not enough

The model may follow examples in simple cases but still over-generate or over-split when transcripts are ambiguous. Schema and validation are needed as a second layer of control.

### Realtime response and canvas writing should be separated

The voice agent should stay concise and conversational. The canvas pipeline should do the slower structuring work in the background.

### Canvas updates need layout constraints

Even semantically correct cards can feel bad if nodes appear too far away or edges become too long. Layout should be centered around the selected node, capture anchor, or viewport center.

### Research should enter as structured evidence

Research output should be split into small findings and attached to the current map. Long prose summaries do not fit the canvas interaction model.

## Build Log Template

Use this template to record future iterations.

```text
Date:

What I built:

Problem observed:

Design decision:

Workflow / agent orchestration change:

What failed or surprised me:

What I learned:

Next experiment:
```

## Next Experiments

1. Build a 5-case benchmark of messy brainstorm transcripts.
2. Add a diagram planning step before canvas command generation.
3. Generate 2-3 candidate structures for selected benchmark cases.
4. Add a critic pass to check over-splitting, edge quality, and language fidelity.
5. Improve layout constraints so new nodes stay close to the relevant center.
6. Run human evaluation using fidelity, clarity, insightfulness, actionability, and cognitive load.

# Demo Script V3 Lite: Hypothesis Evolution on the Current Canvas

## Core Idea

This demo keeps the product concept from V3, but adapts the UI to what the current implementation can reliably show.

The demo is not about fancy animation. It is about seeing the thinking state change on the canvas:

```text
Scattered thought
→ Initial hypothesis
→ Evidence challenges it
→ Hypothesis revision
→ Evidence confidence
→ Action outline
```

The line the audience should remember:

> I didn’t replace your thinking. I helped make it visible.

## Scene

A PM opens the workspace after uploading three short context files:

- [interview notes](./demo-context/interview-notes-teams-recap.md)
- [Teams chat after a launch review](./demo-context/launch-review-chat-excerpt.txt)
- [Planner/Jira follow-up tasks](./demo-context/planner-followups.csv)

The product should use these files as background context, but the visible demo starts with the user thinking out loud.

---

# Current Implementation Constraints

This script assumes the current product can do:

- upload files and summarize them into session context
- inject uploaded context into realtime agent and canvas generation
- create a five-node canvas scaffold: `Focus`, `Observation`, `Context`, `Analysis`, `Action`
- add/update/connect cards through agent canvas ops
- show quiet insight as a small suggestion
- attach quiet insight into an existing canvas structure

This script does **not** assume:

- animated fade/expand hypothesis transitions
- source hover cards
- special breakpoint UI
- automatic layout morphing into a workflow
- section-by-section accept controls inside the canvas

Where the vision version says “fades,” “expands,” or “unfolds,” this implementation version uses ordinary cards, card updates, and connections.

---

# Demo Flow

## Step 0: Context Loaded

### UI

The user uploads the three context files. The app shows the upload success prompt:

```text
Context ready: 3 files attached. I'll use them as background while we think through the canvas.
```

### Expected State

The canvas can still be empty.

The uploaded material is available to realtime agent and canvas generation as `[Uploaded context summary]`.

---

## Step 1: User Starts With Uncertainty

### User Says

```text
Okay...

I thought the opportunity was probably improving recap quality before.

Now I want to think through the opportunity using the materials I uploaded.

I’m not sure anymore. Something feels off.
```

### Expected Canvas State

The canvas generates or updates the standard scaffold:

```text
Focus
Find the real opportunity
```

```text
Observation
The user is uncertain; evidence feels mixed across interview notes, Teams chat, and tasks.
```

```text
Context
Uploaded material includes interview notes, post-meeting Teams chat, and Planner/Jira follow-ups.
```

```text
Analysis
Current hypothesis: recap quality may be the bottleneck.
```

```text
Action
Do not jump to a feature yet. First test the current hypothesis against evidence.
```

### AI Says

```text
Recording your current hypothesis.
```

### Why This Works

The initial hypothesis is visible, but not treated as truth.

---

## Step 2: Test the Weak Hypothesis

### User Says

```text
Maybe the recap just isn’t detailed enough.
```

### Expected Canvas Update

Agent updates `Analysis` or adds a small connected card under `Analysis`:

```text
Possible Explanation
Recap lacks detail
```

### AI Says

```text
Let’s test that.
```

### User Says

```text
Wait...

The interview notes say she actually liked the recap.

She used it to catch up.
```

### Expected Canvas Update

Agent updates `Analysis` with a rejection note:

```text
Analysis
Rejected explanation: recap simply lacks detail.

Reason: Interview Notes say the participant liked the recap for memory and catch-up.
```

Optional connected evidence card:

```text
Evidence: Interview Notes
Participant positively evaluated recap for memory and catch-up.
```

### Why This Works

The demo shows AI helping the user disprove a tempting weak hypothesis, not handing them the answer.

---

## Step 3: Evidence Attaches to the Existing Structure

### User Says

```text
But after every meeting, she still opens OneNote.

She makes a checklist after reading the recap.
```

### Expected Canvas Update

Agent adds or updates evidence under `Observation` or `Analysis`:

```text
Evidence: Interview Notes
Creates a separate OneNote/Loop checklist after launch reviews.
```

### User Says

```text
Then she messages teammates asking, “Who’s taking this?”
```

### Expected Canvas Update

Another evidence card attaches to `Analysis`:

```text
Evidence: Interview Notes
Manual owner confirmation after recap.
```

### Quiet Insight Behavior

If quiet insight appears, it should not become a standalone island.

Example quiet insight:

```text
The evidence points to a gap between remembering the meeting and turning it into accountable follow-up.
```

User clicks:

```text
Attach to canvas
```

Expected result:

- the insight attaches under `Analysis`
- an edge connects `Analysis` → quiet insight card

### Why This Works

This uses current implementation: quiet insight is still surfaced separately, but acceptance connects it into the existing structure.

---

## Step 4: Represent the Workflow With Cards

### User Says

```text
Can you map what is actually happening after the meeting?
```

### AI Says

```text
Let me reorganize these observations into the user’s workflow.
```

### Expected Canvas Update

Agent adds compact workflow cards and connects them:

```text
Meeting Discussion
```

```text
Recap
```

```text
PM Checklist
```

```text
Owner Confirmation
```

```text
Planner/Jira Update
```

Then adds a connected Analysis card:

```text
Breakpoint
Manual translation happens between Recap and PM Checklist.
```

### AI Says

```text
I think this is where the friction begins.
```

### Why This Works

This avoids promising animated workflow transformation. The current canvas can show this as connected cards.

---

## Step 5: Hypothesis Revision

### User Says

```text
Wait...

She never actually complained about the recap.

She liked it.
```

### Expected Canvas Update

Agent updates `Analysis`:

```text
Analysis
Old hypothesis: Recap Quality
Status: weakened by evidence

Working hypothesis: Execution Handoff
Reason: recap helps memory, but the PM still manually converts it into checklist, owner confirmation, and task updates.
```

Agent may add a connected card:

```text
Rejected Hypothesis
Recap Quality

Reason: recap was positively evaluated in Interview Notes.
```

### AI Says

```text
That explains more of what we’ve observed.
```

### Why This Works

The audience sees hypothesis revision using ordinary cards. No animation required.

---

## Step 6: Evidence Raises Confidence

### User Says

```text
Oh. The Teams chat also matters.

People were asking, “Was that actually decided?”
```

### Expected Canvas Update

Agent adds evidence attached to `Analysis`:

```text
Evidence: Teams Chat
“Was the rollout change actually decided?”
```

### User Says

```text
Someone else asked whether ownership had changed.
```

### Expected Canvas Update

Agent adds another evidence card:

```text
Evidence: Teams Chat
Risk review owner still unclear.
```

Agent may use uploaded Planner/Jira context to add:

```text
Evidence: Planner/Jira
Owner/status still unconfirmed on follow-ups.
```

Agent updates `Analysis`:

```text
Analysis
Working hypothesis: Execution Handoff
Confidence: stronger

Why: evidence now appears across Interview Notes, Teams Chat, and Planner/Jira follow-ups.
```

### AI Says

```text
Now the evidence is pointing in one direction.
```

### Why This Works

The source labels are plain text inside cards, which current UI can support.

---

## Step 7: Action Outline as a Normal Canvas Output

### AI Says

```text
I think we’ve collected enough evidence.

Here’s the opportunity I believe the evidence supports.
```

### Expected Canvas Update

Agent updates `Action` or adds a connected `Action Outline` card:

```text
Action Outline

Core Insight:
Teams/Copilot recap helps people remember the meeting, but it does not reliably turn the meeting into shared execution state.

Product Opportunity:
Outcome Handoff: separate decisions, owners, risks, unresolved questions, and follow-ups after a meeting.

Validation Plan:
Compare normal recap vs Outcome Handoff with PMs running launch reviews. Measure decision/owner identification time, clarification messages, and confidence in shared execution state.

Next Actions:
Mock editable Outcome Handoff categories; test with 5 PMs; compare against normal recap; decide whether this belongs in Teams recap, Planner, Loop, or a new handoff layer.
```

### Why This Works

The current UI does not support section-by-section Accept inside the canvas, so the demo should show one structured action card instead of staged acceptance.

---

# Final Screen

The final canvas should show connected, non-fancy structure:

```text
Focus
Find the real opportunity

Observation
recap useful; checklist created; owner confirmation; scattered evidence

Context / Workflow
Meeting Discussion → Recap → PM Checklist → Owner Confirmation → Planner/Jira Update

Analysis
Old hypothesis: Recap Quality weakened
Working hypothesis: Execution Handoff
Confidence: stronger

Evidence
Interview Notes: recap appreciated; checklist created
Teams Chat: “Was that actually decided?”; ownership ambiguity
Planner/Jira: owner/status unconfirmed

Action
Outcome Handoff + Validation Plan + Next Actions
```

### Final AI Narration

```text
I didn’t replace your thinking.

I helped make it visible.
```

---

# Implementation Fit

This version is intentionally less fancy than the vision version.

It relies only on current capabilities:

- cards
- card updates
- connected cards
- source labels inside card text
- quiet insight attachment
- uploaded context injection
- final action card

It does not require:

- animation
- hover source provenance
- source badges
- confidence meter UI
- automatic layout morphing
- section-by-section accept controls

---

# Evaluation Notes

Evaluate this demo as hypothesis evolution, not chat quality.

Pass criteria:

- Initial hypothesis is visible.
- Weak hypothesis is tested and rejected.
- Evidence is attached to existing structure.
- Evidence includes plain-text source labels.
- Workflow is represented with connected cards.
- Analysis updates from `Recap Quality` to `Execution Handoff`.
- Final action is grounded in visible evidence.

Failure cases:

- AI jumps straight to Outcome Handoff.
- Evidence appears only in the final answer.
- Quiet insight becomes a disconnected card.
- Canvas becomes a flat list with no hypothesis revision.

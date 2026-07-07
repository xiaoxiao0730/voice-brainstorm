# Demo Script V2: From Scattered Thinking to Defensible Product Insight

## Core Idea

This demo is not about AI giving better answers.

It is about AI maintaining and evolving a persistent thinking state.

The audience should be able to literally see thinking becoming clearer:

```text
User speaks
Canvas changes
AI lightly narrates
User continues
Canvas restructures itself
AI points to one place
Evidence accumulates
Artifact naturally emerges
```

The line the audience should remember:

> The canvas was thinking with the user.

## Scene

A PM has just finished reading:

- interview notes
- Teams chat after a launch review
- Planner/Jira follow-up tasks

She opens the workspace because she does not know what the real product opportunity is.

She is not asking AI to summarize. She is trying to think.

---

# 3-Minute Demo Flow

## Step 0: Context Loaded

### UI

Empty canvas.

Right-side context panel:

```text
Uploaded Context
✓ Interview Notes
✓ Teams Chat
✓ Planner Tasks

Ready
```

### AI Says

```text
I’ve loaded the material.

Let’s figure this out together.
```

### Expected State

No insight yet. No summary yet. Just readiness.

The workspace should feel calm and empty, waiting for the user’s thinking to begin.

---

## Step 1: Uncertainty Becomes Visible

### User Says

```text
Okay...

I thought the opportunity was probably improving recap quality.

But after reading everything, I’m honestly not sure anymore.

Something feels off.
```

### Canvas Changes

Two cards appear.

```text
Focus
Find the real opportunity
```

```text
Current Hypothesis
Recap quality may be the bottleneck
```

### AI Says

```text
Recording your current hypothesis.
```

### User Continues

```text
Everything just feels kind of mixed together.

There are decisions, follow-ups, owners...

but I can’t tell what the actual issue is.
```

### Canvas Changes

A new card fades in.

```text
Observation
• evidence feels scattered
• direction is still unclear
• decisions, owners, and follow-ups are mixed together
```

### AI Says

```text
Let’s organize before solving.
```

### Expected State Transition

```text
S0: scattered description
→ early S1: current hypothesis and uncertainty are visible
```

The system has not summarized. It has externalized the user’s current thinking state.

---

## Step 2: Observations Accumulate Live

### User Says

```text
One thing is interesting though.

She actually liked Copilot recap.
```

### Canvas Changes

Observation updates.

```text
Observation
✓ recap helps memory
```

### User Says

```text
But after every meeting...

she still opens OneNote.
```

### Canvas Changes

Observation updates again.

```text
Observation
✓ recap helps memory
✓ creates separate checklist
```

### User Says

```text
Then she messages teammates asking,

“Who’s taking this?”
```

### Canvas Changes

Observation updates again.

```text
Observation
✓ recap helps memory
✓ creates separate checklist
✓ manually confirms ownership
```

A subtle Analysis card appears without replacing anything.

```text
Possible Pattern
Recap
↓
Execution
```

### AI Says

```text
Interesting.

I’m seeing a possible gap.
```

### Expected State Transition

```text
S0: concrete observations
→ S1: pattern begins to emerge
```

The audience sees the system tracking the user’s thought as it forms.

---

## Step 3: The Canvas Reorganizes Into Context

### UI Motion

The canvas restructures itself into a workflow.

```text
Meeting Discussion
↓
Recap
↓
Checklist
↓
Owner Confirmation
↓
Planner
```

Between `Recap` and `Checklist`, a highlighted breakpoint appears.

```text
⚠ Manual Translation
```

### AI Says

```text
I think this is where the friction begins.
```

### Expected State Transition

```text
S1: context grounding
→ S2: causal structure becomes visible
```

This is the first wow moment.

The AI does not explain the whole problem. The canvas makes the context understandable.

---

## Step 4: The User Revises Their Hypothesis

### User Says

```text
Wait...

She never actually complained about the recap.

She liked it.
```

### Canvas Changes

The old hypothesis fades.

```text
Current Hypothesis
Recap Quality
```

A new hypothesis expands.

```text
Stronger Hypothesis
Execution Handoff
```

Evidence starts collecting automatically.

```text
Evidence
✓ recap appreciated
✓ second checklist
✓ owner confirmation
✓ manual translation
```

### AI Says

```text
That explains more of what we’ve observed.
```

### Expected State Transition

```text
S2: hypothesis revision
```

This is the central cognitive shift:

```text
Before: Maybe recap quality is the problem.
After: Maybe recap is useful, but execution handoff is broken.
```

---

## Step 5: Evidence Keeps Growing Naturally

### User Says

```text
Oh.

The Teams chat also matters.

People were asking, “Was that actually decided?”
```

### Canvas Changes

Evidence updates.

```text
Evidence
✓ decision ambiguity
```

### User Says

```text
Someone else asked whether ownership had changed.
```

### Canvas Changes

Evidence updates again.

```text
Evidence
✓ ownership ambiguity
```

### AI Says

```text
Now the evidence is pointing in one direction.
```

### Expected State Transition

```text
S2 stabilization
```

The audience should notice that nobody said, “Let’s collect evidence.”

The system was already maintaining the evidence layer.

---

## Step 6: Action Emerges Only After the State Is Ready

### Canvas State Before Generation

The canvas already contains:

```text
Focus
Find the real opportunity

Observation
✓ recap useful
✓ checklist created
✓ owner confirmation
✓ scattered evidence

Workflow
Meeting Discussion
↓
Recap
↓
Checklist
↓
Planner

Analysis
Execution Handoff
not Recap Quality

Evidence
5 independent signals
```

### AI Says

```text
I think we’ve collected enough evidence.

Here’s the opportunity I believe the evidence supports.
```

### Canvas Changes

The Action section unfolds one section at a time.

```text
Action Outline
```

```text
Core Insight
Teams/Copilot recap helps people remember the meeting,
but it does not reliably turn the meeting into shared execution state.
```

```text
Opportunity
Create an Outcome Handoff layer that separates decisions,
owners, risks, unresolved questions, and follow-ups.
```

```text
Validation
Compare normal recap vs Outcome Handoff with PMs running launch reviews.
Measure decision/owner identification time, clarification messages,
and confidence in shared execution state.
```

```text
Next Actions
• Mock editable Outcome Handoff categories
• Test with 5 PMs
• Compare against normal recap
• Decide whether this belongs in Teams recap, Planner, Loop, or a new handoff layer
```

### Expected State Transition

```text
S2: evidence-backed product judgment
→ S3: action-ready outline
```

The AI is not “answering.”

The workspace has evolved enough that the artifact can naturally emerge.

---

# Final Screen

The audience should not see a giant markdown document.

They should see the finished workspace.

```text
Focus
Find the real opportunity

────────────────────────

Observation
✓ recap useful
✓ checklist created
✓ owner confirmation
✓ scattered evidence

────────────────────────

Workflow
Meeting
↓
Recap
↓
Checklist
↓
Planner

────────────────────────

Analysis
Execution Handoff
not Recap Quality

────────────────────────

Evidence
5 independent signals

────────────────────────

Action
Outcome Handoff
Validation Plan
Next Steps
```

### Final AI Narration

```text
We didn’t start with an answer.

We started with uncertainty.

Together, we turned scattered evidence into a product insight you can defend.
```

---

# Demo Timing

Target length: 2.5–3 minutes.

| Moment | Time | What Audience Sees |
| --- | --- | --- |
| Context loaded | 15s | Empty workspace, files ready |
| User uncertainty | 25s | Focus + current hypothesis appear |
| Observations accumulate | 35s | Canvas records thought live |
| Workflow appears | 35s | Context becomes visible |
| Hypothesis flips | 35s | Recap Quality fades, Execution Handoff expands |
| Evidence grows | 30s | Evidence layer stabilizes |
| Action unfolds | 45s | Artifact emerges from state |

---

# Evaluation Notes

This V2 should be evaluated less like a chat transcript and more like state evolution.

Expected high-scoring trajectory:

```text
S0 Observation
User starts with uncertainty and scattered evidence.

S1 Context
Canvas organizes the uploaded material into a workflow.

S2 Analysis
The hypothesis changes from Recap Quality to Execution Handoff.

S3 Action
The final action outline emerges only after evidence is visible.
```

Pass criteria:

- The first output records uncertainty instead of solving.
- The canvas preserves the initial hypothesis before revising it.
- The workflow map appears before the final action outline.
- The breakpoint between `Recap` and `Checklist` is visible.
- Evidence accumulates before the final recommendation.
- The final action is defensible from visible evidence.
- The AI narration stays minimal.

Failure cases:

- AI gives the final product opportunity too early.
- Canvas becomes a flat list of notes.
- The old hypothesis disappears instead of being visibly revised.
- Evidence is only mentioned in the final artifact, not accumulated during the process.
- The demo feels like chat completion rather than state evolution.

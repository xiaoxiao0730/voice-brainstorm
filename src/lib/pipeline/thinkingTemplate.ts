// Schema-driven Live Brief templates.
//
// A template defines the stable slot containers a thinking canvas renders.
// The background canvas lane is constrained to produce patches against one
// of these slot IDs, so the document always groups into a small fixed set
// of cards instead of an unbounded list of free-form blocks.

export type ThinkingSlot = {
  id: string;
  title: string;
  prompt: string; // hint for the LLM and placeholder for empty slots
  multi: boolean; // true → many blocks allowed in this slot
};

export type ThinkingTemplate = {
  id: string;
  name: string;
  description: string;
  slots: ThinkingSlot[];
  available: boolean;
};

export const productThinkingArtifact: ThinkingTemplate = {
  id: "product_thinking_artifact",
  name: "Product Thinking Artifact",
  description: "A product thinker's canvas: question → journey → hypothesis → solution → next steps.",
  available: true,
  slots: [
    {
      id: "current_question",
      title: "Current Question",
      prompt: "The single question or problem the user is wrestling with right now.",
      multi: false,
    },
    {
      id: "user_journey",
      title: "User Journey",
      prompt: "Who the user is and what they go through — context, persona, scenario.",
      multi: true,
    },
    {
      id: "hypothesis",
      title: "Hypothesis",
      prompt: "Working beliefs about why this is true or what might solve it.",
      multi: true,
    },
    {
      id: "info_observation",
      title: "Info & Observation",
      prompt: "Concrete data, quotes, or observations the user has surfaced.",
      multi: true,
    },
    {
      id: "solution",
      title: "Solution",
      prompt: "Candidate solutions, designs, or product moves.",
      multi: true,
    },
    {
      id: "open_questions",
      title: "Open Questions",
      prompt: "Things still unknown or unresolved that need exploring.",
      multi: true,
    },
    {
      id: "next_actions",
      title: "Next Actions",
      prompt: "Concrete next steps the user agreed to or should take.",
      multi: true,
    },
  ],
};

export const TEMPLATES: Record<string, ThinkingTemplate> = {
  [productThinkingArtifact.id]: productThinkingArtifact,
  research: {
    id: "research",
    name: "Research (coming soon)",
    description: "Coming soon",
    slots: [],
    available: false,
  },
  decision: {
    id: "decision",
    name: "Decision (coming soon)",
    description: "Coming soon",
    slots: [],
    available: false,
  },
};

export const DEFAULT_TEMPLATE_ID = productThinkingArtifact.id;

export function getTemplate(id: string | null | undefined): ThinkingTemplate {
  if (id && TEMPLATES[id]?.available) return TEMPLATES[id];
  return productThinkingArtifact;
}

export type SlotId = string;

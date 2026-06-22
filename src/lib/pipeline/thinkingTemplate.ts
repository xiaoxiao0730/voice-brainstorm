// Optional document starters for the Live Brief.
//
// A template no longer renders the canvas — the canvas is now a single
// continuous document. A template is just a list of heading lines that
// get appended to the document when the user picks it, plus optional
// hints fed to the background canvas LLM.

export type ThinkingTemplate = {
  id: string;
  name: string;
  description: string;
  headings: string[];          // empty for "none"
  slotHints?: { title: string; prompt: string }[]; // optional LLM hint
  available: boolean;
};

export const NONE_TEMPLATE_ID = "none";

export const noneTemplate: ThinkingTemplate = {
  id: NONE_TEMPLATE_ID,
  name: "No template",
  description: "Free-form continuous document.",
  headings: [],
  available: true,
};

export const productThinkingArtifact: ThinkingTemplate = {
  id: "product_thinking_artifact",
  name: "Product Thinking Artifact",
  description: "A product thinker's canvas: question → journey → hypothesis → solution → next steps.",
  available: true,
  headings: [
    "Current Question",
    "User Journey",
    "Hypothesis",
    "Info & Observation",
    "Solution",
    "Open Questions",
    "Next Actions",
  ],
  slotHints: [
    { title: "Current Question", prompt: "The single question or problem the user is wrestling with." },
    { title: "User Journey", prompt: "Who the user is and what they go through — context, persona, scenario." },
    { title: "Hypothesis", prompt: "Working beliefs about why this is true or what might solve it." },
    { title: "Info & Observation", prompt: "Concrete data, quotes, or observations the user has surfaced." },
    { title: "Solution", prompt: "Candidate solutions, designs, or product moves." },
    { title: "Open Questions", prompt: "Things still unknown or unresolved that need exploring." },
    { title: "Next Actions", prompt: "Concrete next steps the user agreed to or should take." },
  ],
};

export const TEMPLATES: Record<string, ThinkingTemplate> = {
  [noneTemplate.id]: noneTemplate,
  [productThinkingArtifact.id]: productThinkingArtifact,
  research: {
    id: "research",
    name: "Research (coming soon)",
    description: "Coming soon",
    headings: [],
    available: false,
  },
  decision: {
    id: "decision",
    name: "Decision (coming soon)",
    description: "Coming soon",
    headings: [],
    available: false,
  },
};

export const DEFAULT_TEMPLATE_ID = NONE_TEMPLATE_ID;

export function getTemplate(id: string | null | undefined): ThinkingTemplate {
  if (id && TEMPLATES[id]?.available) return TEMPLATES[id];
  return noneTemplate;
}

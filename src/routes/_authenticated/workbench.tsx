import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose } from "lucide-react";

import type { BriefDocumentHandle } from "@/components/brief/BriefDocument";
import {
  mergeIdeaCanvas,
  treeToIdeaCanvas,
  type IdeaFlowNode,
  type IdeaCanvasState,
  type IdeaNodeKind,
} from "@/components/mindmap/IdeaCanvas";

import { between } from "@/lib/pipeline/orderKey";
import { applyBriefPatch } from "@/lib/pipeline/applyBriefPatch";
import { renderMarkdownToSafeHtml } from "@/lib/markdown";
import { createTranscriptBuffer } from "@/lib/pipeline/transcriptBuffer";
import {
  blockToNodeUpsert,
  nodeToBlock,
  type BriefBlock,
  type BriefDoc,
  type BriefPatch,
  type ResearchResult,
  type TranscriptSegment,
} from "@/lib/pipeline/types";

import { getSpeechToken } from "@/lib/speech.functions";
import { startAzureRecognizer, type SpeechRecognizerHandle } from "@/lib/speech/azureRecognizer";

import {
  createSession,
  deleteSession,
  endSession,
  getSessionContext,
  listSessions,
} from "@/lib/session.functions";

import {
  deleteBriefNode,
  loadBrief,
  loadTranscript,
  persistChunks,
  persistSegment,
  upsertBriefNode,
  acceptPendingBlock,
} from "@/lib/brief.functions";
import { exportExplorationBriefToPdfPrint } from "@/lib/exportPdf";

import { getRealtimeSession } from "@/lib/agent/realtime.functions";
import {
  connectRealtime,
  type CanvasToolOp,
  type RealtimeClient,
} from "@/lib/agent/realtimeClient";
import { formatAgentCanvasContext } from "@/lib/agent/canvasContext";
import { normalizeCanvasEdgeLabel } from "@/lib/canvas/edgeLabels";
import { generateIntervention } from "@/lib/agent/responseGenerator.functions";
import { logIntervention } from "@/lib/agent/interventionLog.functions";
import { createPolicyEngine } from "@/lib/agent/interventionPolicy";
import { assessDensity, assessMindMapTrigger } from "@/lib/agent/segmentGate";
import {
  publish as publishSignal,
  snapshot as signalSnapshot,
  summarizeForInject,
} from "@/lib/agent/signalBus";
import { DEFAULT_TEMPLATE_ID, getTemplate, TEMPLATES } from "@/lib/pipeline/thinkingTemplate";
import { type AgentStatus } from "@/components/agent/AgentPanel";
import { sessionStore } from "@/lib/orchestrator/sessionStore";
import { attachInsightCoordinator } from "@/lib/orchestrator/insightCoordinator";
import { pipelineTracer } from "@/lib/debug/pipelineTracer";
import { generateMindMap } from "@/lib/mindmap/generateMindMap.functions";
import { loadIdeaCanvas, saveIdeaCanvas } from "@/lib/ideaCanvas.functions";
import {
  planThoughtTurnContract,
  type ThoughtTurnCanvasOp,
} from "@/lib/orchestrator/thoughtTurnContract.functions";
import {
  structureVoiceToCanvas,
  type StructuredVoiceCanvas,
} from "@/lib/orchestrator/structureVoiceToCanvas.functions";
import {
  generateCanvasInsight,
  type CanvasInsight,
} from "@/lib/orchestrator/canvasInsight.functions";
import { exportExplorationBrief } from "@/lib/orchestrator/exportExplorationBrief.functions";
import { cleanVoiceCapture } from "@/lib/orchestrator/cleanVoiceCapture.functions";
import {
  formatThinkingState,
  loadThinkingState,
  type SessionThinkingState,
} from "@/lib/agent/thinkingState.functions";
import { AgentDock } from "@/components/agent/AgentDock";
import { FullscreenBoard, ThinkingBoard } from "@/components/board/FullscreenBoard";

export const Route = createFileRoute("/_authenticated/workbench")({
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Murmur — Co-thinking Workbench" },
      {
        name: "description",
        content: "Voice-driven AI co-thinking workbench with a live brief canvas.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined",
      },
    ],
  }),
  component: Workbench,
});

type SessionRow = {
  id: string;
  title: string;
  status: string;
  started_at: string;
  ended_at: string | null;
};
type VoiceMode = "idle" | "canvas_capture" | "inline_dictation" | "conversation";

const EMPTY_THINKING_STATE: SessionThinkingState = {
  current_goal: "",
  user_intent: "",
  assumptions: [],
  open_questions: [],
  promising_directions: [],
  decision_points: [],
  last_turn_id: null,
};

function relative(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function errorMessage(error: unknown, fallback = "Something went wrong") {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function briefDocToPlainText(doc: BriefDoc) {
  return Object.values(doc)
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
    .map((b) => {
      if (b.level === 2) return `## ${(b.heading ?? b.body ?? "").trim()}`;
      return (b.body ?? b.heading ?? "").trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function htmlToCanvasText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownToCanvasText(value: string) {
  return htmlToCanvasText(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\s*\((https?:\/\/[^\s)]+)\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizeResearchBody(text: string, max = 220) {
  const cleaned = markdownToCanvasText(text).replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

const BRIEF_NODE_PREFIX = "brief-block-";
const MANUAL_CANVAS_CAPTURE = true;

function mergeBriefIntoCanvas(doc: BriefDoc, canvas: IdeaCanvasState): IdeaCanvasState {
  if (MANUAL_CANVAS_CAPTURE) {
    return stripBriefMirrorNodes(canvas);
  }

  const blocks = Object.values(doc).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  if (blocks.length === 0) return canvas;

  const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
  let y = 100;
  const briefNodes = blocks.map((block) => {
    const id = `${BRIEF_NODE_PREFIX}${block.id}`;
    const heading = htmlToCanvasText(block.heading ?? "");
    const body = htmlToCanvasText(block.body ?? "");
    const existing = byId.get(id);
    const title = heading || body.split("\n")[0] || "";
    const remainder = heading ? body : body.split("\n").slice(1).join("\n");
    const node = {
      id,
      type: "textNode",
      position: existing?.position ?? { x: 120, y },
      data: {
        ...existing?.data,
        title,
        body: remainder,
        kind: block.level === 2 ? ("focus" as const) : ("idea" as const),
        width: existing?.data.width ?? (block.level === 2 ? 620 : 560),
        textSize:
          existing?.data.textSize ?? (block.level === 2 ? ("large" as const) : ("normal" as const)),
        bold: existing?.data.bold ?? block.level === 2,
        italic: existing?.data.italic ?? false,
        textAlign: existing?.data.textAlign ?? ("left" as const),
      },
    };
    y += block.level === 2 ? 118 : 96;
    return node;
  });
  const briefIds = new Set(briefNodes.map((node) => node.id));
  return {
    ...canvas,
    nodes: [...briefNodes, ...canvas.nodes.filter((node) => !briefIds.has(node.id))],
  };
}

function stripBriefMirrorNodes(canvas: IdeaCanvasState): IdeaCanvasState {
  const nodes = canvas.nodes.filter((node) => !node.id.startsWith(BRIEF_NODE_PREFIX));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...canvas,
    nodes,
    edges: canvas.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function didRemoveCanvasItems(previous: IdeaCanvasState, next: IdeaCanvasState) {
  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  const nextEdgeIds = new Set(next.edges.map((edge) => edge.id));
  return (
    previous.nodes.some((node) => !nextNodeIds.has(node.id)) ||
    previous.edges.some((edge) => !nextEdgeIds.has(edge.id))
  );
}

type IdeaCanvasCache = {
  version: 2;
  updatedAt: number;
  syncedAt: number;
  state: IdeaCanvasState;
};

function ideaCanvasCacheKey(sessionId: string) {
  return `murmur.ideaCanvas.${sessionId}`;
}

function readIdeaCanvasCache(sessionId: string): IdeaCanvasCache | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(ideaCanvasCacheKey(sessionId));
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<IdeaCanvasCache>;
    if (parsed.version !== 2 || !parsed.state) return null;
    return {
      version: 2,
      updatedAt: Number(parsed.updatedAt) || 0,
      syncedAt: Number(parsed.syncedAt) || 0,
      state: stripBriefMirrorNodes({
        nodes: Array.isArray(parsed.state.nodes) ? parsed.state.nodes : [],
        edges: Array.isArray(parsed.state.edges) ? parsed.state.edges : [],
      }),
    };
  } catch {
    return null;
  }
}

function writeIdeaCanvasCache(
  sessionId: string,
  state: IdeaCanvasState,
  meta: { updatedAt: number; syncedAt: number },
) {
  if (typeof window === "undefined") return;
  const snapshot = stripBriefMirrorNodes(state);
  window.localStorage.setItem(
    ideaCanvasCacheKey(sessionId),
    JSON.stringify({ version: 2, ...meta, state: snapshot } satisfies IdeaCanvasCache),
  );
}

function markIdeaCanvasCacheSynced(sessionId: string, state: IdeaCanvasState, syncedAt: number) {
  const current = readIdeaCanvasCache(sessionId);
  if (current && current.updatedAt > syncedAt) return;
  writeIdeaCanvasCache(sessionId, state, { updatedAt: syncedAt, syncedAt });
}

function ideaCanvasToPlainText(canvas: IdeaCanvasState) {
  return canvas.nodes
    .map((node) => {
      const title = node.data.title?.trim();
      const body = node.data.body?.trim();
      return [title, body].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .slice(-30)
    .join("\n");
}

function ideaCanvasExistingCards(canvas: IdeaCanvasState) {
  return canvas.nodes
    .filter((node) => !node.id.startsWith(BRIEF_NODE_PREFIX) && node.data.title?.trim())
    .map((node) => ({
      title: node.data.title.trim(),
      body: (node.data.body ?? "").trim(),
      kind: node.data.kind,
    }))
    .slice(-80);
}

function normalizeTitleKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function nextIdeaId(prefix = "contract") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function estimateNodeWidth(node: IdeaFlowNode) {
  return Number(node.data.width ?? (node.type === "textNode" ? 520 : 260));
}

function estimateNodeHeight(node: IdeaFlowNode) {
  return Number(node.data.height ?? (node.type === "textNode" ? 132 : 178));
}

function findOpenCanvasPosition(
  nodes: IdeaFlowNode[],
  desired: { x: number; y: number },
  width = 260,
  height = 178,
) {
  const candidates = [
    desired,
    { x: desired.x + 320, y: desired.y },
    { x: desired.x, y: desired.y + 230 },
    { x: desired.x + 320, y: desired.y + 230 },
    { x: desired.x - 320, y: desired.y },
    { x: desired.x, y: desired.y - 230 },
    { x: desired.x + 640, y: desired.y },
    { x: desired.x + 320, y: desired.y - 230 },
    { x: desired.x - 320, y: desired.y + 230 },
  ];

  for (const candidate of candidates) {
    const overlaps = nodes.some((node) => {
      const nodeWidth = estimateNodeWidth(node);
      const nodeHeight = estimateNodeHeight(node);
      return !(
        candidate.x + width + 28 < node.position.x ||
        candidate.x > node.position.x + nodeWidth + 28 ||
        candidate.y + height + 28 < node.position.y ||
        candidate.y > node.position.y + nodeHeight + 28
      );
    });
    if (!overlaps) return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
  }

  return { x: Math.round(desired.x + 96), y: Math.round(desired.y + 96) };
}

function snapCanvasPosition(position: { x: number; y: number }, grid = 24) {
  return {
    x: Math.round(position.x / grid) * grid,
    y: Math.round(position.y / grid) * grid,
  };
}

const STRUCTURED_KIND_COLUMN: Record<IdeaNodeKind, number> = {
  focus: 0,
  question: 1,
  idea: 2,
  risk: 3,
  decision: 4,
  next: 5,
};

function defaultCanvasCaptureAnchor(canvas: IdeaCanvasState) {
  const visibleNodes = canvas.nodes.filter((node) => !node.id.startsWith(BRIEF_NODE_PREFIX));
  if (visibleNodes.length === 0) return { x: 260, y: 180 };
  const right = Math.max(...visibleNodes.map((node) => node.position.x + estimateNodeWidth(node)));
  const top = Math.min(...visibleNodes.map((node) => node.position.y));
  return { x: Math.round(right + 240), y: Math.round(Math.max(160, top + 80)) };
}

function mergeStructuredCanvasCapture(
  current: IdeaCanvasState,
  result: StructuredVoiceCanvas,
  origin: { x: number; y: number },
): IdeaCanvasState {
  const nodes: IdeaFlowNode[] = current.nodes.map((node) => ({ ...node, selected: false }));
  const edges: IdeaCanvasState["edges"] = [...current.edges];
  const byTitle = new Map<string, IdeaFlowNode>();
  for (const node of nodes) {
    const key = normalizeTitleKey(node.data.title ?? "");
    if (key) byTitle.set(key, node);
  }

  const added: IdeaFlowNode[] = [];
  const localKindCounts: Record<IdeaNodeKind, number> = {
    focus: 0,
    question: 0,
    idea: 0,
    risk: 0,
    decision: 0,
    next: 0,
  };
  const attachedCounts = new Map<string, number>();
  const edgeExists = (source: string, target: string, label?: string) =>
    edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        String(edge.label ?? "") === String(label ?? ""),
    );

  result.cards.forEach((card, index) => {
    const title = card.title.trim();
    if (!title) return;
    const titleKey = normalizeTitleKey(title);
    const existing = byTitle.get(titleKey);
    if (existing) return;

    const attachTo = byTitle.get(normalizeTitleKey(card.attachToTitle));
    const width = card.kind === "focus" ? 300 : 260;
    const kind = card.kind as IdeaNodeKind;
    const desired = attachTo
      ? (() => {
          const count = attachedCounts.get(attachTo.id) ?? 0;
          attachedCounts.set(attachTo.id, count + 1);
          return snapCanvasPosition({
            x: attachTo.position.x + estimateNodeWidth(attachTo) + 144,
            y: attachTo.position.y + count * 216,
          });
        })()
      : (() => {
          const count = localKindCounts[kind];
          localKindCounts[kind] += 1;
          const col = STRUCTURED_KIND_COLUMN[kind] ?? STRUCTURED_KIND_COLUMN.idea;
          return snapCanvasPosition({
            x: origin.x - 150 + col * 312,
            y: origin.y - 96 + count * 216,
          });
        })();
    const position = findOpenCanvasPosition([...nodes, ...added], desired, width, 178);
    const node: IdeaFlowNode = {
      id: nextIdeaId(`voice-${card.kind}`),
      type: "ideaNode",
      position,
      selected: added.length === 0,
      data: {
        title,
        body: card.body.trim(),
        kind,
        width,
      },
    };
    added.push(node);
    byTitle.set(titleKey, node);

    const relation = normalizeCanvasEdgeLabel(card.relation) || undefined;
    if (attachTo && !edgeExists(attachTo.id, node.id, relation)) {
      edges.push({
        id: nextIdeaId("voice-edge"),
        source: attachTo.id,
        target: node.id,
        sourceHandle: "right",
        targetHandle: "left",
        type: "editable",
        label: relation,
      });
    }
  });

  let extraEdgeCount = 0;
  for (const edge of result.edges) {
    if (extraEdgeCount >= 2) break;
    const source = byTitle.get(normalizeTitleKey(edge.sourceTitle));
    const target = byTitle.get(normalizeTitleKey(edge.targetTitle));
    if (!source || !target || source.id === target.id) continue;
    const label = normalizeCanvasEdgeLabel(edge.label) || undefined;
    if (edgeExists(source.id, target.id, label)) continue;
    const targetWasAttachedToSource = result.cards.some(
      (card) =>
        normalizeTitleKey(card.title) === normalizeTitleKey(edge.targetTitle) &&
        normalizeTitleKey(card.attachToTitle) === normalizeTitleKey(edge.sourceTitle),
    );
    if (targetWasAttachedToSource) continue;
    edges.push({
      id: nextIdeaId("voice-edge"),
      source: source.id,
      target: target.id,
      sourceHandle: "right",
      targetHandle: "left",
      type: "editable",
      label,
    });
    extraEdgeCount += 1;
  }

  return { nodes: [...nodes, ...added], edges };
}

function Workbench() {
  const navigate = useNavigate();

  const { session: requestedSessionId } = Route.useSearch();

  // Server fn hooks
  const list = useServerFn(listSessions);
  const createS = useServerFn(createSession);

  const endS = useServerFn(endSession);
  const deleteS = useServerFn(deleteSession);
  const getCtx = useServerFn(getSessionContext);

  const getToken = useServerFn(getSpeechToken);
  const loadB = useServerFn(loadBrief);
  const loadT = useServerFn(loadTranscript);
  const upsertN = useServerFn(upsertBriefNode);
  const deleteN = useServerFn(deleteBriefNode);
  const acceptN = useServerFn(acceptPendingBlock);
  const saveChunks = useServerFn(persistChunks);
  const saveSegment = useServerFn(persistSegment);
  const generateNudge = useServerFn(generateIntervention);
  const logIntv = useServerFn(logIntervention);
  const mintRealtime = useServerFn(getRealtimeSession);
  const genMindMap = useServerFn(generateMindMap);
  const loadCanvas = useServerFn(loadIdeaCanvas);
  const saveCanvas = useServerFn(saveIdeaCanvas);
  const planContract = useServerFn(planThoughtTurnContract);
  const structureCanvasCapture = useServerFn(structureVoiceToCanvas);
  const generateQuietInsight = useServerFn(generateCanvasInsight);
  const buildExplorationBrief = useServerFn(exportExplorationBrief);
  const cleanCapture = useServerFn(cleanVoiceCapture);
  const loadState = useServerFn(loadThinkingState);

  // UI state
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<{ id: string; text: string }[]>([]);
  const [doc, setDoc] = useState<BriefDoc>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideaCanvas, setIdeaCanvas] = useState<IdeaCanvasState>({ nodes: [], edges: [] });
  const [mapLoading, setMapLoading] = useState(false);
  const [thinkingState, setThinkingState] = useState<SessionThinkingState>(EMPTY_THINKING_STATE);
  const [quietInsight, setQuietInsight] = useState<CanvasInsight | null>(null);
  const [exportingBrief, setExportingBrief] = useState(false);

  // The audio panel and floating dock share one realtime session.
  const [audioCollapsed, setAudioCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("audio-panel-collapsed") === "true";
  });
  const [agentDockCollapsed, setAgentDockCollapsed] = useState(false);
  const [boardFullscreen, setBoardFullscreen] = useState(false);
  const [captureAnchor, setCaptureAnchor] = useState<{ x: number; y: number } | null>(null);
  const [captureActive, setCaptureActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("idle");

  useEffect(() => {
    try {
      window.localStorage.setItem("audio-panel-collapsed", String(audioCollapsed));
    } catch {
      /* ignore */
    }
  }, [audioCollapsed]);

  // Agent state — Realtime voice lane only. Background canvas lane runs
  // whenever `listening` is true, independent of `agentEnabled`.
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("off");

  const [userEmail, setUserEmail] = useState<string | null>(null);

  const MODEL_OPTIONS = [
    { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "openai/gpt-4o", label: "GPT-4o" },
  ] as const;
  const [model, setModel] = useState<(typeof MODEL_OPTIONS)[number]["id"]>("openai/gpt-4o-mini");
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  // Thinking template
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const template = useMemo(() => getTemplate(templateId), [templateId]);
  const templateRef = useRef(template);
  useEffect(() => {
    templateRef.current = template;
  }, [template]);

  // Refs
  const recognizerRef = useRef<SpeechRecognizerHandle | null>(null);
  const bufferRef = useRef<ReturnType<typeof createTranscriptBuffer> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRunRef = useRef(0);
  const docRef = useRef(doc);
  const ideaCanvasRef = useRef(ideaCanvas);
  const thinkingStateRef = useRef<SessionThinkingState>(EMPTY_THINKING_STATE);
  const activeSessionRef = useRef(activeSessionId);

  // Agent refs
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const connectAgentInFlightRef = useRef(false);
  const policyRef = useRef(createPolicyEngine(null));
  const recentTextsRef = useRef<string[]>([]);
  const recentThoughtTurnsRef = useRef<string[]>([]);
  const listeningRef = useRef(listening);
  const agentConnectedAtRef = useRef(Date.now());
  const isEditingRef = useRef(false);
  const injectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInjectRef = useRef<string | null>(null);
  const captureAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const captureTextsRef = useRef<string[]>([]);
  const captureActiveRef = useRef(false);
  const voiceModeRef = useRef<VoiceMode>("idle");
  const stoppingListeningRef = useRef(false);
  const briefDocRef = useRef<BriefDocumentHandle | null>(null);
  const skipIdeaCanvasSaveRef = useRef(false);
  const loadedIdeaCanvasSessionRef = useRef<string | null>(null);
  const ideaCanvasSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedIdeaCanvasRef = useRef<IdeaCanvasState>({ nodes: [], edges: [] });
  const openSessionSeqRef = useRef(0);
  const pendingBriefWritesRef = useRef<Set<Promise<unknown>>>(new Set());
  const lastAutoMapAtRef = useRef(0);
  const autoMindMapTurnIdsRef = useRef<Set<string>>(new Set());
  const coThinkingTurnIdsRef = useRef<Set<string>>(new Set());
  const [appliedTemplateId, setAppliedTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);

  // Stage 4: running research tasks (taskId → query) for the active session.
  const [researchRunning, setResearchRunning] = useState<Record<string, string>>({});

  // True while the slow lane (decideBrief) is working on a finalized turn —
  // drives the canvas activity indicator.
  const [briefThinking, setBriefThinking] = useState(false);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    ideaCanvasRef.current = ideaCanvas;
  }, [ideaCanvas]);
  useEffect(() => {
    thinkingStateRef.current = thinkingState;
  }, [thinkingState]);
  useEffect(() => {
    activeSessionRef.current = activeSessionId;
    policyRef.current = createPolicyEngine(activeSessionId);
    recentTextsRef.current = [];
    recentThoughtTurnsRef.current = [];
    coThinkingTurnIdsRef.current.clear();
    lastAutoMapAtRef.current = 0;
    captureAnchorRef.current = null;
    captureTextsRef.current = [];
    captureActiveRef.current = false;
    voiceModeRef.current = "idle";
    setCaptureAnchor(null);
    setCaptureActive(false);
    setVoiceMode("idle");
    setQuietInsight(null);
  }, [activeSessionId]);

  const selectCaptureAnchor = useCallback((position: { x: number; y: number }) => {
    if (captureActiveRef.current) return;
    captureAnchorRef.current = position;
    setCaptureAnchor(position);
  }, []);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  // Persist template + applied-template per session.
  useEffect(() => {
    if (!activeSessionId || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(`murmur.template.${activeSessionId}`);
    if (saved && TEMPLATES[saved]?.available) setTemplateId(saved);
    else setTemplateId(DEFAULT_TEMPLATE_ID);
    const applied = window.localStorage.getItem(`murmur.template.applied.${activeSessionId}`);
    setAppliedTemplateId(applied && TEMPLATES[applied] ? applied : DEFAULT_TEMPLATE_ID);
  }, [activeSessionId]);
  useEffect(() => {
    if (!activeSessionId || typeof window === "undefined") return;
    window.localStorage.setItem(`murmur.template.${activeSessionId}`, templateId);
  }, [templateId, activeSessionId]);
  useEffect(() => {
    if (!activeSessionId || typeof window === "undefined") return;
    window.localStorage.setItem(`murmur.template.applied.${activeSessionId}`, appliedTemplateId);
  }, [appliedTemplateId, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    skipIdeaCanvasSaveRef.current = true;
    loadedIdeaCanvasSessionRef.current = null;
    lastPersistedIdeaCanvasRef.current = { nodes: [], edges: [] };

    const emptyCanvas: IdeaCanvasState = { nodes: [], edges: [] };
    void (async () => {
      try {
        const fromDb = (await loadCanvas({
          data: { sessionId: activeSessionId },
        })) as IdeaCanvasState;
        if (cancelled) return;
        const next = stripBriefMirrorNodes({
          nodes: Array.isArray(fromDb.nodes) ? fromDb.nodes : [],
          edges: Array.isArray(fromDb.edges) ? fromDb.edges : [],
        });
        const localCache = readIdeaCanvasCache(activeSessionId);
        const hasUnsyncedLocal = !!localCache && localCache.updatedAt > localCache.syncedAt;
        const restored = hasUnsyncedLocal ? localCache.state : next;
        lastPersistedIdeaCanvasRef.current = next;
        setIdeaCanvas(mergeBriefIntoCanvas(docRef.current, restored));
        loadedIdeaCanvasSessionRef.current = activeSessionId;
        if (hasUnsyncedLocal) {
          void sessionStore
            .getOrCreate(activeSessionId)
            .canvasQueue.run(async () => {
              await saveCanvas({
                data: {
                  sessionId: activeSessionId,
                  nodes: restored.nodes,
                  edges: restored.edges,
                },
              });
              if (loadedIdeaCanvasSessionRef.current === activeSessionId) {
                lastPersistedIdeaCanvasRef.current = restored;
              }
              markIdeaCanvasCacheSynced(activeSessionId, restored, localCache.updatedAt);
            })
            .catch((e) => console.warn("[ideaCanvas] restore unsynced local canvas failed", e));
        } else {
          markIdeaCanvasCacheSynced(activeSessionId, next, Date.now());
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("[ideaCanvas] load failed, using empty canvas fallback", e);
        lastPersistedIdeaCanvasRef.current = emptyCanvas;
        setIdeaCanvas(mergeBriefIntoCanvas(docRef.current, emptyCanvas));
        loadedIdeaCanvasSessionRef.current = activeSessionId;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, loadCanvas, saveCanvas]);

  useEffect(() => {
    if (!activeSessionId) return;
    setIdeaCanvas((current) => mergeBriefIntoCanvas(doc, current));
  }, [activeSessionId, doc]);

  const persistIdeaCanvasSnapshot = useCallback(
    (sessionId: string, snapshot: IdeaCanvasState, snapshotUpdatedAt: number) =>
      sessionStore
        .getOrCreate(sessionId)
        .canvasQueue.run(async () => {
          await saveCanvas({
            data: { sessionId, nodes: snapshot.nodes, edges: snapshot.edges },
          });
          if (loadedIdeaCanvasSessionRef.current === sessionId) {
            lastPersistedIdeaCanvasRef.current = snapshot;
          }
          markIdeaCanvasCacheSynced(sessionId, snapshot, snapshotUpdatedAt);
        })
        .catch((e) => console.warn("[ideaCanvas] save failed", e)),
    [saveCanvas],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    if (loadedIdeaCanvasSessionRef.current !== activeSessionId) return;
    const snapshot = stripBriefMirrorNodes(ideaCanvas);
    if (skipIdeaCanvasSaveRef.current) {
      skipIdeaCanvasSaveRef.current = false;
      return;
    }
    const updatedAt = Date.now();
    const currentCache = readIdeaCanvasCache(activeSessionId);
    writeIdeaCanvasCache(activeSessionId, snapshot, {
      updatedAt,
      syncedAt: currentCache?.syncedAt ?? 0,
    });
    const shouldSaveImmediately = didRemoveCanvasItems(
      lastPersistedIdeaCanvasRef.current,
      snapshot,
    );
    if (ideaCanvasSaveTimerRef.current) clearTimeout(ideaCanvasSaveTimerRef.current);
    if (shouldSaveImmediately) {
      ideaCanvasSaveTimerRef.current = null;
      void persistIdeaCanvasSnapshot(activeSessionId, snapshot, updatedAt);
      return;
    }
    ideaCanvasSaveTimerRef.current = setTimeout(() => {
      const sid = activeSessionId;
      // Serialize through the per-session canvas queue: saveIdeaCanvas is a
      // non-atomic delete-then-insert, so overlapping saves could interleave
      // and corrupt/drop nodes. The mutex guarantees one save at a time.
      void persistIdeaCanvasSnapshot(sid, snapshot, updatedAt);
    }, 700);
    return () => {
      if (ideaCanvasSaveTimerRef.current) {
        clearTimeout(ideaCanvasSaveTimerRef.current);
        ideaCanvasSaveTimerRef.current = null;
      }
    };
  }, [activeSessionId, ideaCanvas, persistIdeaCanvasSnapshot]);

  // Debounced injectContext: only fire after 3s of canvas/edit quiet.
  const scheduleInject = useCallback((note: string) => {
    pendingInjectRef.current = note;
    if (injectDebounceRef.current) clearTimeout(injectDebounceRef.current);
    injectDebounceRef.current = setTimeout(() => {
      const n = pendingInjectRef.current;
      pendingInjectRef.current = null;
      injectDebounceRef.current = null;
      if (n && realtimeRef.current) {
        try {
          realtimeRef.current.injectContext(n);
        } catch {
          /* ignore */
        }
      }
    }, 3000);
  }, []);

  const structureThoughtToCanvas = useCallback(
    async (rawText: string, origin?: { x: number; y: number }) => {
      const source = rawText.trim();
      if (!source) return;
      setMapLoading(true);
      try {
        const canvasBefore = ideaCanvasRef.current;
        const result = await structureCanvasCapture({
          data: {
            rawTranscript: source.slice(0, 6000),
            existingCards: ideaCanvasExistingCards(canvasBefore),
            model: modelRef.current,
          },
        });
        const nextCanvas = mergeStructuredCanvasCapture(
          canvasBefore,
          result,
          origin ?? defaultCanvasCaptureAnchor(canvasBefore),
        );
        ideaCanvasRef.current = nextCanvas;
        setIdeaCanvas(nextCanvas);
        scheduleInject(
          `[canvas voice capture]\n${result.summary || result.title}\nRaw transcript was used as source material for the structured cards.`,
        );
      } finally {
        setMapLoading(false);
      }
    },
    [scheduleInject, structureCanvasCapture],
  );

  useEffect(() => {
    if (!activeSessionId) {
      setThinkingState(EMPTY_THINKING_STATE);
      thinkingStateRef.current = EMPTY_THINKING_STATE;
      return;
    }
    let cancelled = false;
    void loadState({ data: { sessionId: activeSessionId } })
      .then((state) => {
        if (cancelled) return;
        setThinkingState(state);
        thinkingStateRef.current = state;
        scheduleInject(`[session thinking state]\n${formatThinkingState(state)}`);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[thinkingState] load failed", e);
        setThinkingState(EMPTY_THINKING_STATE);
        thinkingStateRef.current = EMPTY_THINKING_STATE;
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, loadState, scheduleInject]);

  // ── Shared Thinking State ─────────────────────────────────────────────
  // Whenever the Live Brief canvas changes (slow-lane patches, research
  // writes, manual edits), push a fresh snapshot into the Realtime agent's
  // instructions so the voice lane stays grounded in what the user sees.
  const canvasPushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!realtimeRef.current) return;
    if (canvasPushDebounceRef.current) clearTimeout(canvasPushDebounceRef.current);
    canvasPushDebounceRef.current = setTimeout(() => {
      const client = realtimeRef.current;
      if (!client) return;
      const text = formatAgentCanvasContext({
        canvas: ideaCanvasRef.current,
        recentTranscript: finals.map((item) => item.text),
      });
      try {
        client.updateCanvasSnapshot(text);
      } catch (err) {
        console.warn("[workbench] updateCanvasSnapshot failed", err);
      }
    }, 600);
    return () => {
      if (canvasPushDebounceRef.current) {
        clearTimeout(canvasPushDebounceRef.current);
        canvasPushDebounceRef.current = null;
      }
    };
  }, [agentEnabled, agentStatus, finals, ideaCanvas]);

  // Local no-auth mode.
  useEffect(() => {
    setUserEmail("local mode");
  }, []);

  // Sign out
  const signOut = async () => {
    try {
      await stopListening();
    } catch {
      /* ignore */
    }
    navigate({ to: "/" });
  };

  // Load session list
  const refreshSessions = useCallback(async () => {
    try {
      const rows = await list();
      setSessions(rows as SessionRow[]);
      return rows as SessionRow[];
    } catch (e: unknown) {
      setError(errorMessage(e));
      return [];
    }
  }, [list]);

  const trackBriefWrite = useCallback((write: Promise<unknown>) => {
    pendingBriefWritesRef.current.add(write);
    write.finally(() => pendingBriefWritesRef.current.delete(write));
  }, []);

  const drainBriefWrites = useCallback(async () => {
    const writes = Array.from(pendingBriefWritesRef.current);
    if (writes.length === 0) return;
    await Promise.allSettled(writes);
  }, []);

  // Initial load — honor ?session=… first, else open most recent or create new
  useEffect(() => {
    (async () => {
      const rows = await refreshSessions();
      if (requestedSessionId && rows.some((r) => r.id === requestedSessionId)) {
        await openSession(requestedSessionId);
      } else if (rows.length > 0) {
        await openSession(rows[0].id);
      } else {
        const created = await createS({ data: {} });
        await refreshSessions();
        await openSession(created.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stage 4 helpers — apply coordinator-proposed brief patches as a single
  // pending operation group (one operationId → one Keep/Undo toolbar).
  const applyProposedPatches = useCallback(
    (sessionId: string, operationId: string, patches: BriefPatch[]) => {
      let map: BriefDoc = { ...docRef.current };
      const appended: BriefBlock[] = [];
      for (const patch of patches) {
        const res = applyBriefPatch(map, patch, { sessionId });
        if (!res.result.ok) continue;
        const block: BriefBlock = {
          ...res.result.block,
          isPending: false,
          operationId,
          lastEditedBy: "ai",
          locked: false,
        };
        map = { ...res.doc, [block.id]: block };
        appended.push(block);
      }
      if (appended.length === 0) return;
      setDoc(map);
      docRef.current = map;
      briefDocRef.current?.appendLines(appended);
      for (const b of appended) void persistBlock(b);
      pipelineTracer.log({
        sessionId,
        kind: "brief.applied",
        operationId,
        meta: { blocks: appended.length },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const applyResearchResult = useCallback(
    (sessionId: string, operationId: string | undefined, result: ResearchResult) => {
      const opId = operationId ?? crypto.randomUUID();
      const allKeys = Object.values(docRef.current)
        .map((b) => b.orderKey)
        .sort();
      let lastKey: string | null = allKeys.length ? allKeys[allKeys.length - 1] : null;
      const appended: BriefBlock[] = [];

      // Heading text — escape only (no markdown formatting expected here).
      const headingHtml = renderMarkdownToSafeHtml(`Research: ${result.title || result.query}`);
      const mkHeading = (html: string): BriefBlock => {
        lastKey = between(lastKey, null);
        return {
          id: crypto.randomUUID(),
          sessionId,
          orderKey: lastKey,
          heading: html,
          level: 2,
          body: "",
          lastEditedBy: "ai",
          locked: false,
          sourceChunkIds: [],
          isPending: false,
          operationId: opId,
          researchResultId: result.id,
        };
      };
      const mkParaHtml = (html: string): BriefBlock => {
        lastKey = between(lastKey, null);
        return {
          id: crypto.randomUUID(),
          sessionId,
          orderKey: lastKey,
          heading: "",
          level: 3,
          body: html,
          lastEditedBy: "ai",
          locked: false,
          sourceChunkIds: [],
          isPending: false,
          operationId: opId,
          researchResultId: result.id,
        };
      };

      appended.push(mkHeading(headingHtml));
      if (result.summary?.trim()) {
        appended.push(mkParaHtml(renderMarkdownToSafeHtml(result.summary.trim())));
      }
      for (const f of result.findings) {
        appended.push(mkParaHtml(renderMarkdownToSafeHtml(`- ${f}`)));
      }
      if (result.links.length) {
        const linksMd = result.links
          .map((l) => (l.title ? `[${l.title}](${l.url})` : l.url))
          .join(" · ");
        appended.push(mkParaHtml(renderMarkdownToSafeHtml(`Sources: ${linksMd}`)));
      }

      const map = { ...docRef.current };
      for (const b of appended) map[b.id] = b;
      setDoc(map);
      docRef.current = map;
      briefDocRef.current?.appendLines(appended, { asHtml: true });
      for (const b of appended) void persistBlock(b);
      setIdeaCanvas((current) => {
        const nodes = current.nodes.map((node) => ({ ...node, selected: false }));
        const edges = [...current.edges];
        const titleKey = (title: string) => normalizeTitleKey(title);
        const existingTitles = new Set(nodes.map((node) => titleKey(node.data.title ?? "")));
        const visibleNodes = nodes.filter((node) => !node.id.startsWith(BRIEF_NODE_PREFIX));
        const anchor =
          [...visibleNodes].reverse().find((node) => node.data.kind === "question") ??
          [...visibleNodes].reverse().find((node) => node.data.kind === "focus") ??
          visibleNodes[visibleNodes.length - 1];

        const researchTitle = markdownToCanvasText(result.title || result.query).slice(0, 120);
        const parentTitle = researchTitle || "Research findings";
        let parent = anchor;

        if (!parent) {
          const parentId = nextIdeaId("research-topic");
          parent = {
            id: parentId,
            type: "ideaNode",
            position: findOpenCanvasPosition(nodes, { x: 120, y: 140 }, 320, 178),
            selected: false,
            data: {
              title: parentTitle,
              body: summarizeResearchBody(result.summary || result.query, 180),
              kind: "question",
              width: 320,
            },
          };
          nodes.push(parent);
          existingTitles.add(titleKey(parentTitle));
        }

        const sourceBaseX = parent.position.x + estimateNodeWidth(parent) + 160;
        const sourceBaseY = parent.position.y - 28;
        const findings = (result.findings.length ? result.findings : [result.summary])
          .map((finding) => summarizeResearchBody(finding, 260))
          .filter(Boolean)
          .slice(0, 5);

        const added: IdeaFlowNode[] = [];
        for (const [index, finding] of findings.entries()) {
          const titleSource = finding.split(/[.。;；:：]/)[0] || finding;
          const cardTitle = titleSource.slice(0, 72).trim() || `Finding ${index + 1}`;
          const key = titleKey(cardTitle);
          if (existingTitles.has(key)) continue;
          const width = 340;
          const node: IdeaFlowNode = {
            id: nextIdeaId("research-finding"),
            type: "ideaNode",
            position: findOpenCanvasPosition(
              [...nodes, ...added],
              { x: sourceBaseX, y: sourceBaseY + index * 216 },
              width,
              178,
            ),
            selected: index === 0,
            data: {
              title: cardTitle,
              body: finding.length > cardTitle.length ? finding.slice(cardTitle.length).trim() : "",
              kind: "idea",
              width,
            },
          };
          added.push(node);
          existingTitles.add(key);
          edges.push({
            id: nextIdeaId("research-edge"),
            source: parent.id,
            target: node.id,
            sourceHandle: "right",
            targetHandle: "left",
            type: "editable",
            label: "SUPPORTS",
          });
        }

        if (added.length === 0) return current;
        return { ...current, nodes: [...nodes, ...added], edges };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const applyCanvasOps = useCallback((ops: ThoughtTurnCanvasOp[]) => {
    const meaningful = ops.filter((op) => op.action !== "none");
    if (meaningful.length === 0) return;

    setIdeaCanvas((current) => {
      const nodes = [...current.nodes];
      const edges = [...current.edges];
      const byTitle = new Map(
        nodes
          .map((node) => [node.data.title.trim().toLowerCase(), node] as const)
          .filter(([title]) => title.length > 0),
      );
      const kindCol: Record<ThoughtTurnCanvasOp["kind"], number> = {
        focus: 0,
        idea: 1,
        question: 2,
        risk: 3,
        decision: 4,
        next: 5,
      };

      for (const op of meaningful) {
        const title = op.title.trim();
        const titleKey = title.toLowerCase();
        if ((op.action === "add_card" || op.action === "update_card") && title) {
          const existing = byTitle.get(titleKey);
          if (existing) {
            nodes.splice(
              nodes.findIndex((node) => node.id === existing.id),
              1,
              {
                ...existing,
                data: {
                  ...existing.data,
                  kind: op.kind,
                  body: op.body.trim() || existing.data.body || "",
                },
              },
            );
            continue;
          }

          const sameKindCount = nodes.filter((node) => node.data.kind === op.kind).length;
          const id = nextIdeaId(`contract-${op.kind}`);
          const node = {
            id,
            type: "ideaNode",
            position: {
              x: 80 + kindCol[op.kind] * 260,
              y: 100 + sameKindCount * 130,
            },
            data: {
              title,
              body: op.body.trim(),
              kind: op.kind,
            },
          };
          nodes.push(node);
          byTitle.set(titleKey, node);
          continue;
        }

        if (op.action === "connect") {
          const source = byTitle.get(op.sourceTitle.trim().toLowerCase());
          const target = byTitle.get(op.targetTitle.trim().toLowerCase());
          if (!source || !target || source.id === target.id) continue;
          const id = `${source.id}-${target.id}`;
          if (edges.some((edge) => edge.id === id)) continue;
          const label = normalizeCanvasEdgeLabel(op.label) || undefined;
          edges.push({
            id,
            source: source.id,
            target: target.id,
            sourceHandle: "right",
            targetHandle: "left",
            type: "editable",
            label,
          });
        }
      }

      return { nodes, edges };
    });
  }, []);

  const applyAgentCanvasOps = useCallback(
    (ops: CanvasToolOp[]) => {
      const normalized: ThoughtTurnCanvasOp[] = [];
      for (const op of ops) {
        if (op.action === "add_card" || op.action === "update_card") {
          const title = (op.title ?? op.targetTitle ?? "").trim();
          if (!title) continue;
          normalized.push({
            action: op.action,
            kind: op.kind ?? "idea",
            title,
            body: (op.body ?? "").trim(),
            sourceTitle: "",
            targetTitle: "",
            label: "",
          });
          continue;
        }
        if (op.action === "connect") {
          const sourceTitle = (op.sourceTitle ?? "").trim();
          const targetTitle = (op.targetTitle ?? "").trim();
          if (!sourceTitle || !targetTitle) continue;
          normalized.push({
            action: "connect",
            kind: op.kind ?? "idea",
            title: "",
            body: "",
            sourceTitle,
            targetTitle,
            label: normalizeCanvasEdgeLabel(op.label),
          });
        }
      }
      if (normalized.length === 0) return;
      applyCanvasOps(normalized);
    },
    [applyCanvasOps],
  );

  const addQuietInsightCard = useCallback(() => {
    const card = quietInsight?.suggestedCard;
    const title = card?.title.trim();
    if (!card || !title) return;
    const current = ideaCanvasRef.current;
    const width = 280;
    const position = findOpenCanvasPosition(
      current.nodes,
      snapCanvasPosition({ x: 140, y: 160 + current.nodes.length * 28 }),
      width,
      178,
    );
    const node: IdeaFlowNode = {
      id: nextIdeaId("insight"),
      type: "ideaNode",
      position,
      selected: true,
      data: {
        title,
        body: card.body.trim(),
        kind: card.kind,
        width,
      },
    };
    setIdeaCanvas({
      ...current,
      nodes: [...current.nodes.map((item) => ({ ...item, selected: false })), node],
    });
    setQuietInsight(null);
  }, [quietInsight]);

  // Stage 4: sync sessionStore + attach slow-lane coordinator to the active session.
  // Also subscribe to brief.proposed / research.requested / research.completed.
  useEffect(() => {
    if (!activeSessionId) {
      sessionStore.setActive(null);
      return;
    }
    sessionStore.setActive(activeSessionId);
    const slot = sessionStore.getOrCreate(activeSessionId);

    // The Thought Turn Contract now owns brief writing for each finalized turn.
    // Keep the old brief coordinator detached to avoid duplicate brief patches.
    const detach = () => undefined;

    const detachInsight = MANUAL_CANVAS_CAPTURE
      ? () => undefined
      : attachInsightCoordinator(activeSessionId, {
          getSnapshot: () =>
            Object.values(docRef.current)
              .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
              .map((b) => ({
                id: b.id,
                kind: (b.level === 2 ? "h2" : "p") as "h2" | "p",
                text: (b.level === 2 ? b.heading : b.body) ?? "",
                locked: b.locked,
              })),
          getModel: () => modelRef.current,
        });

    // Slow-lane canvas activity indicator: a finalized turn kicks off
    // decideBrief; clear when it proposes patches, or after a safety timeout
    // (decideBrief may return zero patches and never emit brief.proposed).
    let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
    const offThinking = MANUAL_CANVAS_CAPTURE
      ? () => undefined
      : slot.bus.on("thought_turn.finalized", (e) => {
          if (e.sessionId !== activeSessionRef.current) return;
          setBriefThinking(true);
          if (thinkingTimer) clearTimeout(thinkingTimer);
          thinkingTimer = setTimeout(() => setBriefThinking(false), 6000);
        });

    const offProposed = slot.bus.on("brief.proposed", (e) => {
      if (e.sessionId !== activeSessionId) return;
      setBriefThinking(false);
      if (thinkingTimer) clearTimeout(thinkingTimer);
      applyProposedPatches(e.sessionId, e.operationId, e.patches);
    });
    const offResearchReq = slot.bus.on("research.requested", (e) => {
      if (e.sessionId !== activeSessionId) return;
      setResearchRunning((m) => ({ ...m, [e.taskId]: e.query }));
    });
    const offResearchDone = slot.bus.on("research.completed", (e) => {
      setResearchRunning((m) => {
        const next = { ...m };
        delete next[e.taskId];
        return next;
      });
      if (e.sessionId !== activeSessionId) return;
      applyResearchResult(e.sessionId, e.operationId, e.result);
    });

    return () => {
      detach();
      detachInsight();
      offThinking();
      offProposed();
      offResearchReq();
      offResearchDone();
      if (thinkingTimer) clearTimeout(thinkingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const openSession = useCallback(
    async (id: string) => {
      const seq = ++openSessionSeqRef.current;
      try {
        await stopListening();
      } catch {
        /* ignore */
      }
      briefDocRef.current?.flush();
      await drainBriefWrites();
      setFinals([]);
      setPartial("");
      try {
        const [briefNodes, transcriptRows] = await Promise.all([
          loadB({ data: { sessionId: id } }),
          loadT({ data: { sessionId: id } }),
        ]);
        if (seq !== openSessionSeqRef.current) return;
        const map: BriefDoc = {};
        // Legacy split: a row with BOTH heading and body becomes 2 lines
        // (heading first, body next) so the continuous document keeps both.
        for (const n of briefNodes) {
          const base = nodeToBlock(n);
          const hasHeading = !!base.heading?.trim();
          const hasBody = !!base.body?.trim();
          if (hasHeading && hasBody) {
            const headingId = base.id;
            const bodyId = crypto.randomUUID();
            const bodyKey = between(base.orderKey, null);
            map[headingId] = { ...base, body: "", level: 2 };
            map[bodyId] = {
              ...base,
              id: bodyId,
              orderKey: bodyKey,
              heading: "",
              level: 3,
            };
          } else if (hasHeading) {
            map[base.id] = { ...base, body: "", level: 2 };
          } else {
            map[base.id] = { ...base, heading: "", level: 3 };
          }
        }

        // First time opening a session that has an onboarding prompt → seed
        // it as the first paragraph so the AI treats it as the user's intent.
        if (Object.keys(map).length === 0) {
          try {
            const ctx = await getCtx({ data: { sessionId: id } });
            if (ctx.prompt?.trim()) {
              const seeded: BriefBlock = {
                id: crypto.randomUUID(),
                sessionId: id,
                orderKey: between(null, null),
                heading: "",
                level: 3,
                body: ctx.prompt.trim(),
                lastEditedBy: "user",
                locked: true,
                sourceChunkIds: [],
              };
              map[seeded.id] = seeded;
              void upsertN({ data: blockToNodeUpsert(seeded) }).catch((e) =>
                console.warn("seed upsert failed", e),
              );
            }
          } catch (e) {
            console.warn("getCtx failed", e);
          }
        }
        if (seq !== openSessionSeqRef.current) return;
        setDoc(map);
        docRef.current = map;
        setFinals(
          transcriptRows
            .filter((row) => row.isFinal && row.text.trim())
            .map((row) => ({ id: row.id, text: row.text })),
        );
        setPartial("");
        setActiveSessionId(id);
        // Mirror the active session into the URL so a refresh re-opens the SAME
        // session (the init effect honors ?session=… first). replace: true keeps
        // session switches out of the back/forward history.
        navigate({ to: "/workbench", search: { session: id }, replace: true });
        setError(null);
      } catch (e: unknown) {
        if (seq !== openSessionSeqRef.current) return;
        setDoc({});
        docRef.current = {};
        setActiveSessionId(id);
        navigate({ to: "/workbench", search: { session: id }, replace: true });
        setError(errorMessage(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadB, loadT, getCtx, upsertN, navigate, drainBriefWrites],
  );

  const newSession = async () => {
    const created = await createS({ data: {} });
    await refreshSessions();
    await openSession(created.id);
  };

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const target = sessions.find((s) => s.id === id);
      const label = target?.title ?? "this session";
      if (!window.confirm(`Delete "${label}"? This permanently removes its transcript and brief.`))
        return;
      setMenuOpenFor(null);
      try {
        await deleteS({ data: { sessionId: id } });
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(`murmur.agent.policy.${id}`);
          window.localStorage.removeItem(`murmur.ideaCanvas.${id}`);
        }
        const rows = await refreshSessions();
        if (activeSessionId === id) {
          if (rows.length > 0) {
            await openSession(rows[0].id);
          } else {
            const created = await createS({ data: {} });
            await refreshSessions();
            await openSession(created.id);
          }
        }
      } catch (e: unknown) {
        setError(errorMessage(e, "Delete failed"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteS, sessions, activeSessionId, refreshSessions, openSession],
  );

  // ============= Recording =============

  const persistBlock = useCallback(
    async (block: BriefBlock) => {
      await upsertN({ data: blockToNodeUpsert(block) }).catch((e) =>
        console.warn("upsert failed", e),
      );
    },
    [upsertN],
  );

  const onSegment = useCallback(
    async (segment: TranscriptSegment) => {
      pipelineTracer.log({
        sessionId: segment.sessionId,
        kind: "transcript.segment",
        meta: {
          chars: segment.rawText.length,
          chunks: segment.chunkIds.length,
          boundary: segment.boundaryReason,
        },
      });
      try {
        await saveSegment({
          data: {
            segmentId: segment.segmentId,
            sessionId: segment.sessionId,
            chunkIds: segment.chunkIds,
            rawText: segment.rawText,
            startTimeMs: segment.startTimeMs,
            endTimeMs: segment.endTimeMs,
            boundaryReason: segment.boundaryReason,
          },
        });
      } catch (e: unknown) {
        console.warn("persistSegment failed", e);
      }

      // Feed the long-form ThoughtTurn buffer. The slow-lane coordinator
      // (decideBrief) runs when this buffer finalizes a turn (~1.8s pause).
      try {
        sessionStore.getOrCreate(segment.sessionId).thoughtTurnBuffer.ingest(segment);
      } catch (e) {
        console.warn("thoughtTurnBuffer.ingest failed", e);
      }
    },
    [saveSegment],
  );

  // ---- BACKGROUND CANVAS LANE ----
  // Density-gated. Asks the deep model for one pending line for the
  // continuous document. User Accept/Reject/Edit signals feed the next call.
  const runBackgroundCanvas = useCallback(
    async (segment: TranscriptSegment) => {
      if (!listeningRef.current) return;
      // Edit-mode protection: if the user is mid-edit, pause.
      if (isEditingRef.current) return;
      if (!policyRef.current.shouldEmitCanvas()) return;

      // Density gate
      const verdict = assessDensity(segment.rawText, recentTextsRef.current);
      if (!verdict.substantive) {
        try {
          await logIntv({
            data: {
              sessionId: segment.sessionId,
              segmentId: segment.segmentId,
              decision: "silent",
              responseText: verdict.reason,
            },
          });
        } catch {
          /* best effort */
        }
        return;
      }

      recentTextsRef.current = [...recentTextsRef.current, segment.rawText].slice(-6);

      const tpl = templateRef.current;
      const snapshot = Object.values(docRef.current)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
        .map((b) => ({
          kind: (b.level === 2 ? "h2" : "p") as "h2" | "p",
          text: (b.level === 2 ? b.heading : b.body) ?? "",
          isPending: !!b.isPending,
          locked: b.locked,
        }));

      const userSignals = signalSnapshot().map((s) => ({
        type: s.type,
        heading: s.heading,
      }));

      const templateHint =
        tpl.headings.length > 0
          ? {
              name: tpl.name,
              headings: tpl.headings,
              slotHints: tpl.slotHints ?? [],
            }
          : null;

      setAgentStatus((s) => (s === "speaking" ? s : "thinking"));
      setAiLoading(true);

      let result:
        | {
            emit: true;
            line: { kind: "h2" | "p"; text: string; rationale: string };
            insight?: string;
          }
        | { emit: false; insight?: string; error?: string };
      try {
        result = (await generateNudge({
          data: {
            latestText: segment.rawText,
            recentTexts: recentTextsRef.current.slice(0, -1),
            snapshot,
            templateHint,
            userSignals,
            model: modelRef.current,
          },
        })) as typeof result;
      } catch (e) {
        console.warn("generateIntervention failed", e);
        setAgentStatus((s) => (s === "speaking" ? s : realtimeRef.current ? "listening" : "off"));
        setAiLoading(false);
        return;
      }

      if (result.insight) scheduleInject(`[background insight] ${result.insight}`);

      if (!result.emit) {
        try {
          await logIntv({
            data: {
              sessionId: segment.sessionId,
              segmentId: segment.segmentId,
              decision: "silent",
            },
          });
        } catch {
          /* best effort */
        }
        setAgentStatus((s) => (s === "speaking" ? s : realtimeRef.current ? "listening" : "off"));
        setAiLoading(false);
        return;
      }

      const line = result.line;
      const sid = segment.sessionId;
      const allKeys = Object.values(docRef.current)
        .map((b) => b.orderKey)
        .sort();
      const newBlock: BriefBlock = {
        id: crypto.randomUUID(),
        sessionId: sid,
        orderKey: between(allKeys.length ? allKeys[allKeys.length - 1] : null, null),
        heading: line.kind === "h2" ? line.text : "",
        level: line.kind === "h2" ? 2 : 3,
        body: line.kind === "h2" ? "" : line.text,
        lastEditedBy: "ai",
        locked: false,
        sourceChunkIds: [],
        isPending: false,
        rationale: line.rationale,
      };
      const map = { ...docRef.current, [newBlock.id]: newBlock };
      setDoc(map);
      docRef.current = map;
      // Imperatively append to the editor without disturbing caret/state.
      briefDocRef.current?.appendLines([newBlock]);
      await persistBlock(newBlock);
      policyRef.current.recordCanvas();

      publishSignal({
        type: "pending_appear",
        slotId: "",
        heading: newBlock.heading,
        body: newBlock.body,
      });
      scheduleInject(
        summarizeForInject({
          type: "pending_appear",
          slotId: "",
          heading: newBlock.heading,
          body: newBlock.body,
          ts: Date.now(),
        }),
      );

      try {
        await logIntv({
          data: {
            sessionId: segment.sessionId,
            segmentId: segment.segmentId,
            decision: "pending",
            responseText: newBlock.body || newBlock.heading,
          },
        });
      } catch {
        /* best effort */
      }

      setAgentStatus((s) => (s === "speaking" ? s : realtimeRef.current ? "listening" : "off"));
      setAiLoading(false);
    },
    [generateNudge, logIntv, persistBlock, scheduleInject],
  );

  const commitCanvasVoiceCapture = useCallback(
    async (rawText: string, position: { x: number; y: number }) => {
      const source = rawText.trim();
      if (!source) return;
      setBriefThinking(true);
      try {
        await structureThoughtToCanvas(source, position);
        setQuietInsight(null);
        const nextCanvas = ideaCanvasRef.current;
        void generateQuietInsight({
          data: {
            latestThought: source.slice(0, 6000),
            canvasText: ideaCanvasToPlainText(nextCanvas).slice(0, 5000),
            model: modelRef.current,
          },
        })
          .then((insight) => {
            if (!insight.emit) return;
            setQuietInsight(insight);
          })
          .catch((error) => console.warn("[quietInsight] failed", error));
      } catch (captureError) {
        setError(
          captureError instanceof Error
            ? captureError.message
            : "Could not structure the voice capture.",
        );
      } finally {
        setBriefThinking(false);
        captureAnchorRef.current = null;
        setCaptureAnchor(null);
      }
    },
    [generateQuietInsight, structureThoughtToCanvas],
  );

  const startListening = async (options?: {
    connectRealtime?: boolean;
    captureToCanvas?: boolean;
    inlineDictation?: boolean;
  }) => {
    if (
      listening ||
      stoppingListeningRef.current ||
      voiceModeRef.current !== "idle" ||
      !activeSessionId
    )
      return;
    setError(null);
    const captureToCanvas = options?.captureToCanvas ?? false;
    const inlineDictation = options?.inlineDictation ?? false;
    const nextVoiceMode: VoiceMode = inlineDictation
      ? "inline_dictation"
      : captureToCanvas
        ? "canvas_capture"
        : "conversation";
    if (captureToCanvas && !captureAnchorRef.current) {
      const anchor = defaultCanvasCaptureAnchor(ideaCanvasRef.current);
      captureAnchorRef.current = anchor;
      setCaptureAnchor(anchor);
    }
    captureActiveRef.current = captureToCanvas || inlineDictation;
    captureTextsRef.current = [];
    voiceModeRef.current = nextVoiceMode;
    setCaptureActive(captureToCanvas || inlineDictation);
    setVoiceMode(nextVoiceMode);
    try {
      const { token, region } = await getToken();

      // Mic level meter
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error("AudioContext is not supported in this browser.");
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const meterRunId = ++meterRunRef.current;
      const tick = () => {
        if (meterRunRef.current !== meterRunId || !analyserRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel((prev) => prev * 0.6 + Math.min(1, rms * 3) * 0.4);
        if (meterRunRef.current === meterRunId) rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // Buffer
      const sessionId = activeSessionId;
      const buf = createTranscriptBuffer({
        sessionId,
        onSegment,
      });
      bufferRef.current = buf;

      // Recognizer
      const handle = await startAzureRecognizer({
        token,
        region,
        micStream: stream,
        onEvent: (e) => {
          if (e.kind === "partial") {
            setPartial(e.text);
          } else if (e.kind === "final") {
            const chunkId = crypto.randomUUID();
            setPartial("");
            setFinals((f) => [...f, { id: chunkId, text: e.text }]);
            if (captureActiveRef.current && e.text.trim()) {
              captureTextsRef.current.push(e.text.trim());
            }
            pipelineTracer.log({
              sessionId,
              kind: "azure.final_chunk",
              meta: { chars: e.text.length, sample: e.text.slice(0, 60) },
            });
            // Persist chunk + push to buffer
            const endMs = Math.round(e.offsetMs + e.durationMs);
            saveChunks({
              data: {
                sessionId,
                chunks: [
                  {
                    id: chunkId,
                    text: e.text,
                    isFinal: true,
                    startMs: Math.round(e.offsetMs),
                    endMs,
                    lang: e.lang,
                  },
                ],
              },
            }).catch((err) => console.warn("persistChunks failed", err));
            if (captureActiveRef.current) return;
            buf.pushFinal({
              id: chunkId,
              text: e.text,
              startMs: Math.round(e.offsetMs),
              endMs,
              lang: e.lang,
            });
          } else if (e.kind === "error") {
            setError(e.message);
          }
        },
      });
      recognizerRef.current = handle;
      setListening(true);
      if (options?.connectRealtime !== false) {
        setAgentEnabled(true);
        void connectAgent();
      } else {
        setAgentStatus("off");
      }
    } catch (e: unknown) {
      setError(errorMessage(e));
      await stopListening();
    }
  };

  const stopListening = useCallback(async (): Promise<string> => {
    if (stoppingListeningRef.current) return "";
    stoppingListeningRef.current = true;
    const shouldCommitCapture = captureActiveRef.current;
    const capturePosition = captureAnchorRef.current;
    const stoppingMode = voiceModeRef.current;
    try {
      voiceModeRef.current = "idle";
      setListening(false);
      setCaptureActive(false);
      setVoiceMode("idle");
      setPartial("");
      setLevel(0);
      meterRunRef.current += 1;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (audioCtxRef.current) {
        try {
          await audioCtxRef.current.close();
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      if (recognizerRef.current) {
        try {
          await recognizerRef.current.stop();
        } catch {
          /* ignore */
        }
        recognizerRef.current = null;
      }
      if (bufferRef.current) {
        if (!shouldCommitCapture) bufferRef.current.forceFlush("manual_stop");
        bufferRef.current.dispose();
        bufferRef.current = null;
      }
      // Disconnect the agent too — its mic track is cloned from the now-stopped stream.
      if (realtimeRef.current) {
        try {
          await realtimeRef.current.disconnect();
        } catch {
          /* ignore */
        }
        realtimeRef.current = null;
      }
      connectAgentInFlightRef.current = false;
      setAgentEnabled(false);
      setAgentStatus("off");
      const captureText = captureTextsRef.current.join(" ").trim();
      captureTextsRef.current = [];
      if (
        stoppingMode === "canvas_capture" &&
        shouldCommitCapture &&
        capturePosition &&
        captureText
      ) {
        await commitCanvasVoiceCapture(captureText, capturePosition);
      }
      return captureText;
    } finally {
      stoppingListeningRef.current = false;
    }
  }, [commitCanvasVoiceCapture]);

  const startInlineDictation = async () => {
    if (voiceModeRef.current !== "idle") return;
    await startListening({ connectRealtime: false, inlineDictation: true });
  };

  const stopInlineDictation = useCallback(async () => {
    if (voiceModeRef.current !== "inline_dictation") return "";
    const rawText = await stopListening();
    if (!rawText) return "";
    try {
      const result = await cleanCapture({
        data: {
          text: rawText.slice(0, 6000),
          model: modelRef.current,
        },
      });
      return result.text.trim();
    } catch (error) {
      console.warn("[inlineDictation] clean failed", error);
      return rawText;
    }
  }, [cleanCapture, stopListening]);

  useEffect(
    () => () => {
      void stopListening();
    },
    [stopListening],
  );

  // ============= Agent connect / toggle / feedback =============

  const connectAgent = useCallback(async () => {
    if (realtimeRef.current || connectAgentInFlightRef.current) return;
    if (!streamRef.current || !activeSessionRef.current) {
      setError("Start listening first so the agent can hear you.");
      return;
    }
    connectAgentInFlightRef.current = true;
    setAgentStatus("connecting");
    try {
      const { clientSecret, model: rtModel } = await mintRealtime();
      const client = await connectRealtime({
        clientSecret,
        model: rtModel,
        micStream: streamRef.current,
        sessionId: activeSessionRef.current,
        events: {
          onConnected: () => {
            agentConnectedAtRef.current = Date.now();
            setAgentStatus("listening");
          },
          onAgentSpeakingStart: () => setAgentStatus("speaking"),
          onAgentSpeakingEnd: () => setAgentStatus("listening"),
          onUserBargeIn: () => setAgentStatus("listening"),
          onDisconnected: () => setAgentStatus("off"),
          onAgentTranscript: (text) => {
            const sessionId = activeSessionRef.current;
            if (!sessionId || !text) return;
            // Surface the agent's spoken line in the transcript list and
            // persist it as a chunk so it shows up alongside user speech.
            const chunkId = crypto.randomUUID();
            const labeled = `Agent: ${text}`;
            setFinals((f) => [...f, { id: chunkId, text: labeled }]);
            // Use a small offset relative to agent-connect time — the DB
            // column is a 32-bit integer, so raw Date.now() overflows.
            const offset = Date.now() - agentConnectedAtRef.current;
            saveChunks({
              data: {
                sessionId,
                chunks: [
                  {
                    id: chunkId,
                    text: labeled,
                    isFinal: true,
                    startMs: offset,
                    endMs: offset,
                    lang: "agent",
                  },
                ],
              },
            }).catch((err) => console.warn("persist agent chunk failed", err));
          },
          onError: (err) => {
            console.warn("realtime error", err);
            setAgentStatus("error");
          },
          onCanvasOpsProposed: ({ reason, ops }) => {
            applyAgentCanvasOps(ops);
            scheduleInject(
              `[agent canvas write]\n${reason || "Agent applied canvas changes."}\nOps: ${ops
                .map((op) => op.action)
                .join(", ")}`,
            );
          },
        },
      });
      realtimeRef.current = client;
      connectAgentInFlightRef.current = false;
      client.updateCanvasSnapshot(
        formatAgentCanvasContext({
          canvas: ideaCanvasRef.current,
          recentTranscript: finals.map((item) => item.text),
        }),
      );
    } catch (e: unknown) {
      connectAgentInFlightRef.current = false;
      setError(errorMessage(e, "Failed to connect agent"));
      setAgentStatus("error");
    }
  }, [applyAgentCanvasOps, finals, mintRealtime, saveChunks, scheduleInject]);

  const promptAgent = useCallback(() => {
    const client = realtimeRef.current;
    if (!client) return;
    if (client.isAgentSpeaking()) client.cancel();
    // Server VAD already creates replies automatically. Starting another
    // response here can make the agent answer the same user turn twice.
  }, []);

  const toggleAgentConversation = () => {
    if (voiceModeRef.current === "canvas_capture") {
      setError(
        "Press Cmd/Ctrl+Shift+Space again to finish the canvas capture before starting an AI conversation.",
      );
      return;
    }
    if (voiceModeRef.current === "conversation" || listening) {
      void stopListening();
      return;
    }
    void startListening({ connectRealtime: true, captureToCanvas: false });
  };

  // Note: agent lifecycle is owned by startListening / stopListening.

  // Hotkeys (outside text inputs):
  //   Cmd/Ctrl+Shift+Space toggles canvas voice capture on/off
  useEffect(() => {
    const isTextTarget = (target: EventTarget | null) => {
      const t = target as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    };

    const beginCanvasCapture = () => {
      const anchor = captureAnchorRef.current ?? defaultCanvasCaptureAnchor(ideaCanvasRef.current);
      captureAnchorRef.current = anchor;
      setCaptureAnchor(anchor);
      void startListening({ connectRealtime: false, captureToCanvas: true });
    };

    const stopCanvasCapture = () => {
      if (voiceModeRef.current !== "canvas_capture") return;
      void stopListening();
    };

    const isVoiceCaptureHotkey = (e: KeyboardEvent) =>
      e.code === "Space" && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!isVoiceCaptureHotkey(e)) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();

      if (voiceModeRef.current === "canvas_capture") {
        stopCanvasCapture();
        return;
      }
      if (voiceModeRef.current === "conversation") return;
      beginCanvasCapture();
    };

    const onWindowBlur = () => {
      stopCanvasCapture();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopCanvasCapture();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pagehide", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("pagehide", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, stopListening, activeSessionId]);

  // ============= Document handlers =============

  // Single delta callback from the continuous editor. Diffed against the
  // editor's internal snapshot; we just persist to Supabase and mirror state.
  const onPersistDelta = useCallback(
    ({ upserts, deletedIds }: { upserts: BriefBlock[]; deletedIds: string[] }) => {
      if (upserts.length === 0 && deletedIds.length === 0) return;
      const map = { ...docRef.current };
      for (const id of deletedIds) delete map[id];
      for (const b of upserts) map[b.id] = b;
      setDoc(map);
      docRef.current = map;
      for (const b of upserts) {
        trackBriefWrite(persistBlock(b));
        publishSignal({ type: "edit", slotId: "", heading: b.heading, body: b.body });
        scheduleInject(
          summarizeForInject({
            type: "edit",
            slotId: "",
            heading: b.heading,
            body: b.body,
            ts: Date.now(),
          }),
        );
      }
      for (const id of deletedIds) {
        const sessionId = activeSessionRef.current;
        if (!sessionId) continue;
        trackBriefWrite(
          deleteN({ data: { id, sessionId } }).catch((e) => console.warn("delete failed", e)),
        );
      }
    },
    [persistBlock, deleteN, scheduleInject, trackBriefWrite],
  );

  const onCanvasChange = useCallback(
    (next: IdeaCanvasState) => {
      ideaCanvasRef.current = next;
      setIdeaCanvas(next);

      let nextDoc = docRef.current;
      let changed = false;
      for (const node of next.nodes) {
        if (!node.id.startsWith(BRIEF_NODE_PREFIX)) continue;
        const blockId = node.id.slice(BRIEF_NODE_PREFIX.length);
        const block = nextDoc[blockId];
        if (!block) continue;

        const nodeTitle = node.data.title.trim();
        const nodeBody = (node.data.body ?? "").trim();
        const previousTitle = htmlToCanvasText(block.heading ?? "");
        const previousBody = htmlToCanvasText(block.body ?? "");
        const nextTitle = block.level === 2 ? nodeTitle : "";
        const nextBody =
          block.level === 2 ? nodeBody : [nodeTitle, nodeBody].filter(Boolean).join("\n");
        if (previousTitle === nextTitle && previousBody === nextBody) continue;

        const updated: BriefBlock = {
          ...block,
          heading: nextTitle ? renderMarkdownToSafeHtml(nextTitle) : "",
          body: nextBody ? renderMarkdownToSafeHtml(nextBody) : "",
          lastEditedBy: "user",
        };
        if (!changed) nextDoc = { ...nextDoc };
        nextDoc[blockId] = updated;
        changed = true;
        trackBriefWrite(persistBlock(updated));
      }

      if (changed) {
        docRef.current = nextDoc;
        setDoc(nextDoc);
      }
    },
    [persistBlock, trackBriefWrite],
  );

  const onAcceptPending = useCallback(
    async (id: string) => {
      const existing = docRef.current[id];
      if (!existing) return;
      const next: BriefBlock = {
        ...existing,
        isPending: false,
        locked: true,
        lastEditedBy: "user",
      };
      const map = { ...docRef.current, [id]: next };
      setDoc(map);
      docRef.current = map;
      await acceptN({ data: { id, sessionId: next.sessionId } }).catch((e) =>
        console.warn("accept failed", e),
      );
      publishSignal({ type: "accept", slotId: "", heading: next.heading, body: next.body });
      scheduleInject(
        summarizeForInject({
          type: "accept",
          slotId: "",
          heading: next.heading,
          body: next.body,
          ts: Date.now(),
        }),
      );
      void logIntv({
        data: {
          sessionId: next.sessionId,
          decision: "accept",
          responseText: next.body || next.heading,
        },
      }).catch(() => undefined);
    },
    [acceptN, logIntv, scheduleInject],
  );

  const onRejectPending = useCallback(
    async (id: string) => {
      const existing = docRef.current[id];
      const next = { ...docRef.current };
      delete next[id];
      setDoc(next);
      docRef.current = next;
      if (existing) {
        await deleteN({ data: { id, sessionId: existing.sessionId } }).catch((e) =>
          console.warn("reject failed", e),
        );
      }
      if (existing) {
        publishSignal({
          type: "reject",
          slotId: "",
          heading: existing.heading,
          body: existing.body,
        });
        scheduleInject(
          summarizeForInject({
            type: "reject",
            slotId: "",
            heading: existing.heading,
            body: existing.body,
            ts: Date.now(),
          }),
        );
        void logIntv({
          data: {
            sessionId: existing.sessionId,
            decision: "reject",
            responseText: existing.body || existing.heading,
          },
        }).catch(() => undefined);
      }
    },
    [deleteN, logIntv, scheduleInject],
  );

  const onIsEditingChange = useCallback((editing: boolean) => {
    isEditingRef.current = editing;
  }, []);

  // Apply a template: append its headings to end of document (idempotent).
  const applyTemplate = useCallback(
    (id: string) => {
      const tpl = TEMPLATES[id];
      if (!tpl?.available) return;
      setTemplateId(id);
      if (id === appliedTemplateId) return; // dedupe re-selection
      setAppliedTemplateId(id);
      if (tpl.headings.length === 0 || !activeSessionId) return;
      const sid = activeSessionId;
      const existingKeys = Object.values(docRef.current)
        .map((b) => b.orderKey)
        .sort();
      let lastKey: string | null = existingKeys.length
        ? existingKeys[existingKeys.length - 1]
        : null;
      const newBlocks: BriefBlock[] = [];
      for (const h of tpl.headings) {
        lastKey = between(lastKey, null);
        const b: BriefBlock = {
          id: crypto.randomUUID(),
          sessionId: sid,
          orderKey: lastKey,
          heading: h,
          level: 2,
          body: "",
          lastEditedBy: "user",
          locked: true,
          sourceChunkIds: [],
        };
        newBlocks.push(b);
      }
      const map = { ...docRef.current };
      for (const b of newBlocks) map[b.id] = b;
      setDoc(map);
      docRef.current = map;
      briefDocRef.current?.appendLines(newBlocks);
      for (const b of newBlocks) void persistBlock(b);
    },
    [appliedTemplateId, activeSessionId, persistBlock],
  );

  const liveText = useMemo(
    () => (finals.map((f) => f.text).join(" ") + " " + partial).trim(),
    [finals, partial],
  );

  const briefPlainText = useMemo(() => briefDocToPlainText(doc), [doc]);

  // Selection → mind map: APPEND a small map from a highlighted snippet.
  const appendMapFromText = useCallback(
    async ({ text, context }: { text: string; context: string }) => {
      const selectedText = text.trim();
      if (!selectedText) return;
      setMapLoading(true);
      setError(null);
      try {
        const res = await genMindMap({
          data: {
            selectedText: selectedText.slice(0, 8000),
            context: context.slice(0, 4000),
            model: modelRef.current,
          },
        });
        const incoming = treeToIdeaCanvas(res.root);
        setIdeaCanvas((current) => mergeIdeaCanvas(current, incoming));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setMapLoading(false);
      }
    },
    [genMindMap],
  );

  // Generate button: REBUILD one structured mind map from the WHOLE brief,
  // replacing the current canvas. This is the "summarize my whole thinking"
  // path — a central topic radiating out into labeled branches.
  const generateMapFromBrief = useCallback(() => {
    const full = briefPlainText || liveText || "";
    if (!full.trim()) {
      setError("Nothing to map yet — capture some thoughts in the brief first.");
      return;
    }
    setMapLoading(true);
    setError(null);
    void genMindMap({
      data: {
        selectedText: full.slice(0, 8000),
        context: "",
        model: modelRef.current,
      },
    })
      .then((res) => {
        setIdeaCanvas(treeToIdeaCanvas(res.root));
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setMapLoading(false);
      });
  }, [genMindMap, briefPlainText, liveText]);

  // Per-turn: the Thought Turn Contract is the main co-thinking orchestrator.
  // One model call decides state, brief ops, canvas ops, next directions, and a
  // grounding hint for the realtime voice agent.
  useEffect(() => {
    if (!activeSessionId) return;
    const slot = sessionStore.getOrCreate(activeSessionId);
    const offTurn = slot.bus.on("thought_turn.finalized", (e) => {
      if (e.sessionId !== activeSessionRef.current) return;
      if (
        voiceModeRef.current === "canvas_capture" ||
        voiceModeRef.current === "inline_dictation"
      ) {
        return;
      }
      if (autoMindMapTurnIdsRef.current.has(e.turnId)) return;

      const text = e.thoughtTurn.combinedText.trim();
      const verdict = assessMindMapTrigger(text, recentThoughtTurnsRef.current);
      if (!verdict.substantive) return;

      const now = Date.now();
      if (now - lastAutoMapAtRef.current < 5000) return;
      lastAutoMapAtRef.current = now;
      autoMindMapTurnIdsRef.current.add(e.turnId);

      setBriefThinking(true);
      void structureThoughtToCanvas(text)
        .catch((err) => console.warn("[conversation mindmap] failed", err))
        .finally(() => setBriefThinking(false));
    });
    return () => offTurn();
  }, [activeSessionId, structureThoughtToCanvas]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (MANUAL_CANVAS_CAPTURE) return;
    const slot = sessionStore.getOrCreate(activeSessionId);
    const offTurn = slot.bus.on("thought_turn.finalized", (e) => {
      if (e.sessionId !== activeSessionRef.current) return;
      if (coThinkingTurnIdsRef.current.has(e.turnId)) return;

      const text = e.thoughtTurn.combinedText.trim();
      if (text.length < 16) return;

      const now = Date.now();
      if (now - lastAutoMapAtRef.current < 5000) return;
      lastAutoMapAtRef.current = now;
      coThinkingTurnIdsRef.current.add(e.turnId);

      const briefText = briefDocToPlainText(docRef.current).slice(0, 6000);
      const mapContext = ideaCanvasToPlainText(ideaCanvasRef.current).slice(0, 4000);
      const recentTurns = recentThoughtTurnsRef.current.slice(-6);
      recentThoughtTurnsRef.current = [...recentTurns, text].slice(-8);

      setBriefThinking(true);
      void planContract({
        data: {
          sessionId: e.sessionId,
          turnId: e.turnId,
          userTurn: text,
          currentThinkingState: thinkingStateRef.current,
          briefText,
          canvasText: mapContext,
          recentTurns,
          model: modelRef.current,
        },
      })
        .then((contract) => {
          setThinkingState(contract.thinkingState);
          thinkingStateRef.current = contract.thinkingState;

          const operationId = crypto.randomUUID();
          const briefOps = contract.briefOps.map((patch) => ({
            ...patch,
            sourceChunkIds: e.thoughtTurn.chunkIds,
          }));
          if (briefOps.length > 0) {
            applyProposedPatches(e.sessionId, operationId, briefOps);
          }
          if (contract.canvasOps.length > 0) {
            applyCanvasOps(contract.canvasOps);
          }

          const voiceContext = [
            `Intent: ${contract.intent}`,
            `Update kind: ${contract.updateKind}`,
            `Mode: ${contract.replyMode}`,
            `Thinking state:\n${formatThinkingState(contract.thinkingState)}`,
            contract.nextDirections.length ? "Next directions:" : "",
            ...contract.nextDirections.map(
              (d, i) => `${i + 1}. ${d.title}${d.why ? ` - ${d.why}` : ""}`,
            ),
            contract.voiceReplyHint ? `Voice hint: ${contract.voiceReplyHint}` : "",
          ].join("\n");
          scheduleInject(`[thought turn contract]\n${voiceContext}`);
        })
        .catch((err) => {
          console.warn("[thoughtTurnContract] planning failed", err);
        })
        .finally(() => {
          setBriefThinking(false);
        });
    });

    return () => offTurn();
  }, [activeSessionId, applyCanvasOps, applyProposedPatches, planContract, scheduleInject]);

  const blockCount = Object.keys(doc).length;
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const canvasTextForExport = useMemo(() => ideaCanvasToPlainText(ideaCanvas), [ideaCanvas]);
  const canExport = blockCount > 0 || canvasTextForExport.trim().length > 0;
  const passiveInsight = useMemo(() => {
    const clampText = (value: string) =>
      value.length > 96 ? `${value.slice(0, 93).trimEnd()}...` : value;
    const decision = thinkingState.decision_points.at(-1);
    if (decision) return `You are reaching a conclusion: ${clampText(decision)}`;
    const question = thinkingState.open_questions.at(-1);
    if (question) return `An open question is emerging: ${clampText(question)}`;
    const direction = thinkingState.promising_directions.at(-1);
    if (direction) return `A promising direction is taking shape: ${clampText(direction)}`;
    return "";
  }, [thinkingState]);
  const canvasAiWriting = briefThinking || aiLoading || mapLoading;
  const canvasStatusItems = useMemo(() => {
    const items: Array<{ id: string; text: string }> = [];
    for (const [taskId, query] of Object.entries(researchRunning)) {
      items.push({
        id: `research-${taskId}`,
        text: query.trim() ? `AI is researching: ${query}` : "AI is researching...",
      });
    }
    if (mapLoading) {
      items.push({ id: "map", text: "AI is weaving your thoughts into the canvas..." });
    } else if (briefThinking) {
      items.push({ id: "brief", text: "AI is structuring the latest thought..." });
    }
    if (aiLoading) {
      items.push({ id: "write", text: "AI is writing to the canvas..." });
    }
    if (exportingBrief) {
      items.push({ id: "export", text: "AI is shaping the exploration brief..." });
    }
    return items;
  }, [aiLoading, briefThinking, exportingBrief, mapLoading, researchRunning]);
  const conversationActive = voiceMode === "conversation";
  const audioActive = voiceMode !== "idle";

  // Stage 4: group pending blocks by operationId for the grouped Keep/Undo toolbar.
  const pendingGroups = useMemo(() => {
    const groups = new Map<string, BriefBlock[]>();
    for (const b of Object.values(doc)) {
      if (!b.isPending || !b.operationId) continue;
      const arr = groups.get(b.operationId) ?? [];
      arr.push(b);
      groups.set(b.operationId, arr);
    }
    return Array.from(groups.entries()).map(([operationId, blocks]) => ({
      operationId,
      blocks: blocks.sort((a, b) => a.orderKey.localeCompare(b.orderKey)),
    }));
  }, [doc]);

  const keepAll = useCallback(
    async (ids: string[]) => {
      for (const id of ids) await onAcceptPending(id);
    },
    [onAcceptPending],
  );
  const undoAll = useCallback(
    async (ids: string[]) => {
      for (const id of ids) await onRejectPending(id);
    },
    [onRejectPending],
  );

  // ============= UI =============

  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden">
      {/* SIDEBAR */}
      <aside
        className={`flex flex-col border-r border-auralis bg-surface transition-[width] duration-300 ease-out ${
          sidebarOpen ? "w-[260px]" : "w-[56px]"
        }`}
      >
        <div className="flex items-center justify-between h-14 px-3 border-b border-auralis shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-9 h-9 rounded-lg hover:bg-surface-variant flex items-center justify-center text-primary"
            aria-label="Toggle sidebar"
          >
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>
          {sidebarOpen && (
            <button
              onClick={newSession}
              className="w-9 h-9 rounded-lg hover:bg-surface-variant flex items-center justify-center text-primary"
              aria-label="New session"
            >
              <span className="material-symbols-outlined text-[20px]">edit_square</span>
            </button>
          )}
        </div>

        {sidebarOpen && (
          <>
            <div className="px-4 pt-4 pb-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-secondary">
                Sessions
              </span>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`group relative w-full rounded-lg transition-colors ${
                    activeSessionId === s.id
                      ? "bg-surface-variant text-primary"
                      : "text-secondary hover:bg-surface-variant/60 hover:text-primary"
                  }`}
                >
                  <button
                    onClick={() => openSession(s.id)}
                    className="w-full text-left px-3 py-2 pr-9"
                  >
                    <div className="text-sm font-medium truncate">{s.title}</div>
                    <div className="text-[11px] text-secondary mt-0.5">
                      {relative(s.started_at)}
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenFor((cur) => (cur === s.id ? null : s.id));
                    }}
                    className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-md flex items-center justify-center text-secondary hover:bg-surface hover:text-primary ${
                      menuOpenFor === s.id
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                    aria-label="Session options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenFor === s.id}
                  >
                    <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                  </button>
                  {menuOpenFor === s.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setMenuOpenFor(null)}
                        aria-hidden="true"
                      />
                      <div
                        role="menu"
                        className="absolute z-20 top-9 right-1.5 min-w-[140px] rounded-md border border-auralis bg-surface shadow-lg py-1"
                      >
                        <button
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteSession(s.id);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-rose-500 hover:bg-surface-variant flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </nav>
            <div className="border-t border-auralis p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-rose-400 via-indigo-300 to-emerald-300" />
                <span className="text-xs text-primary font-medium truncate max-w-[140px]">
                  {userEmail ?? "Murmur"}
                </span>
              </div>
              <button
                onClick={signOut}
                className="text-[11px] text-secondary hover:text-primary"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex min-w-0">
        {/* AUDIO PANEL */}
        {!audioCollapsed && (
          <section className="w-[380px] xl:w-[420px] shrink-0 border-r border-auralis flex flex-col min-h-0">
            <header className="h-14 px-5 flex items-center justify-between border-b border-auralis shrink-0">
              <span className="text-xs uppercase tracking-[0.18em] text-secondary">
                Audio Interaction
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs flex items-center gap-2 ${audioActive ? "text-emerald-600" : "text-secondary"}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${audioActive ? "bg-emerald-500 animate-pulse" : "bg-secondary"}`}
                  />
                  {voiceMode === "canvas_capture"
                    ? "Structuring canvas"
                    : voiceMode === "inline_dictation"
                      ? "Dictating into note"
                      : voiceMode === "conversation"
                        ? "AI conversation"
                        : "Idle"}
                </span>
                <button
                  type="button"
                  onClick={() => setAudioCollapsed(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-secondary hover:bg-surface-variant hover:text-primary"
                  title="Collapse Audio Interaction"
                  aria-label="Collapse Audio Interaction"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </header>

            {/* Waveform */}
            <div className="flex-1 flex items-center justify-center p-6 min-h-0 relative">
              <div className="relative w-[260px] h-[260px] flex items-center justify-center">
                <div
                  className={`absolute inset-0 rounded-full border border-auralis/25 blur-[2px] ${audioActive ? "animate-[ring-pulse_3.2s_ease-out_infinite]" : ""}`}
                />
                <div
                  className={`absolute inset-8 rounded-full border border-auralis/40 ${audioActive ? "animate-[ring-pulse_4.1s_ease-out_infinite_0.6s]" : ""}`}
                />
                <div
                  className={`absolute left-[50px] top-[80px] w-[50px] h-[100px] rounded-full bg-gradient-to-tr from-rose-400 to-orange-300 opacity-80 mix-blend-multiply blur-[6px] ${audioActive ? "animate-[orb-a_3s_ease-in-out_infinite]" : ""}`}
                  style={{ transform: `scale(${1 + level * 0.3})` }}
                />
                <div
                  className={`absolute right-[50px] top-[80px] w-[50px] h-[100px] rounded-full bg-gradient-to-tr from-emerald-300 to-teal-300 opacity-80 mix-blend-multiply blur-[6px] ${audioActive ? "animate-[orb-c_4.2s_ease-in-out_infinite]" : ""}`}
                  style={{ transform: `scale(${1 + level * 0.28})` }}
                />
                <div
                  className={`relative w-[65px] h-[130px] rounded-full bg-gradient-to-tr from-indigo-400 via-violet-400 to-purple-500 opacity-90 blur-[4px] ${audioActive ? "animate-[orb-b_3.6s_ease-in-out_infinite]" : ""}`}
                  style={{ transform: `scale(${1 + level * 0.35})` }}
                />
              </div>
            </div>

            {/* Controls */}
            <div className="px-5 pb-4 flex flex-col items-center justify-center gap-2 shrink-0">
              {/* Agent status line — replaces the old Talk with Agent button. */}
              <div className="pb-2 flex items-center justify-center shrink-0">
                <span className="text-xs text-secondary flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      agentStatus === "connecting"
                        ? "bg-amber-400 animate-pulse"
                        : agentStatus === "thinking"
                          ? "bg-amber-500 animate-pulse"
                          : agentStatus === "speaking"
                            ? "bg-indigo-500 animate-pulse"
                            : agentStatus === "listening"
                              ? "bg-emerald-500"
                              : agentStatus === "error"
                                ? "bg-rose-500"
                                : "bg-secondary"
                    }`}
                  />
                  {agentStatus === "connecting"
                    ? "Agent connecting…"
                    : agentStatus === "thinking"
                      ? "Agent thinking…"
                      : agentStatus === "speaking"
                        ? "Agent speaking…"
                        : agentStatus === "listening"
                          ? "Agent listening"
                          : agentStatus === "error"
                            ? "Agent error"
                            : "Agent idle"}
                </span>
              </div>

              {/* Start / Stop toggle */}
              <button
                onClick={toggleAgentConversation}
                disabled={!activeSessionId || captureActive}
                className={`px-5 py-2.5 rounded-full text-sm font-medium disabled:opacity-40 hover:opacity-90 flex items-center gap-2 ${
                  conversationActive
                    ? "border border-auralis bg-surface text-primary hover:bg-surface-variant"
                    : "bg-primary text-on-primary"
                }`}
                aria-label={
                  captureActive
                    ? voiceMode === "inline_dictation"
                      ? "Inline dictation active"
                      : "Canvas capture active"
                    : conversationActive
                      ? "Stop AI conversation"
                      : "Start AI conversation"
                }
              >
                <span className="material-symbols-outlined text-base">
                  {captureActive ? "graphic_eq" : conversationActive ? "stop" : "mic"}
                </span>
                {captureActive
                  ? voiceMode === "inline_dictation"
                    ? "Dictating into note"
                    : "Canvas capture active"
                  : conversationActive
                    ? "Stop conversation"
                    : "Talk with Agent"}
              </button>
            </div>
            {/* Transcript */}
            <div className="border-t border-auralis bg-surface/60 shrink-0">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-variant/40 transition-colors"
              >
                <span className="text-xs uppercase tracking-[0.18em] text-secondary">
                  Transcript
                </span>
                <span className="material-symbols-outlined text-secondary text-lg">
                  {expanded ? "expand_more" : "expand_less"}
                </span>
              </button>
              <div
                className="grid transition-all duration-300 ease-out"
                style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <div className="px-5 pb-4 max-h-48 overflow-y-auto text-sm leading-relaxed text-primary">
                    {finals.length === 0 && !partial && (
                      <p className="text-secondary italic">
                        Start speaking to see live transcription here…
                      </p>
                    )}
                    {finals.map((f) => (
                      <p key={f.id} className="mb-1">
                        {f.text}
                      </p>
                    ))}
                    {partial && <p className="text-secondary">{partial}</p>}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* CANVAS PANEL */}
        <section className="relative flex-1 flex flex-col min-w-0">
          <header className="h-14 px-6 flex items-center justify-between border-b border-auralis shrink-0">
            <span className="text-xs uppercase tracking-[0.18em] text-secondary">
              Co-thinking Canvas
            </span>
            <div className="flex items-center gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as typeof model)}
                className="px-3 py-1 bg-surface rounded-full text-xs text-primary border border-auralis hover:bg-surface-variant cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="AI model"
                title="Select AI model"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-secondary ml-3 flex items-center gap-1.5">
                {aiLoading ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />{" "}
                    Thinking…
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Synced
                  </>
                )}
              </span>
              <button
                onClick={() => {
                  const title = activeSession?.title ?? "Exploration Brief";
                  setExportingBrief(true);
                  setError(null);
                  void buildExplorationBrief({
                    data: {
                      title,
                      briefText: briefPlainText.slice(0, 8000),
                      canvasText: canvasTextForExport.slice(0, 8000),
                      model: modelRef.current,
                    },
                  })
                    .then((brief) => exportExplorationBriefToPdfPrint(brief))
                    .catch((e) => {
                      setError(e instanceof Error ? e.message : "Export failed");
                    })
                    .finally(() => setExportingBrief(false));
                }}
                disabled={!canExport || exportingBrief}
                className="ml-3 px-3 py-1.5 rounded-full border border-auralis bg-surface text-primary text-xs font-medium hover:bg-surface-variant disabled:opacity-40 flex items-center gap-1.5"
                aria-label="Export to PDF"
                title="Export an AI-structured Exploration Brief to PDF"
              >
                <span className="material-symbols-outlined text-base">download</span>
                {exportingBrief ? "Preparing..." : "Export PDF"}
              </button>
            </div>
          </header>
          {error && (
            <div className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-500 flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-rose-500/70 hover:text-rose-500"
              >
                ✕
              </button>
            </div>
          )}
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <ThinkingBoard
              state={ideaCanvas}
              onChange={onCanvasChange}
              onExit={() => undefined}
              mode="embedded"
              onEnterFullscreen={() => setBoardFullscreen(true)}
              showAgentDock={false}
              captureAnchor={captureAnchor}
              captureActive={captureActive}
              onCanvasPointSelect={selectCaptureAnchor}
              agentStatus={agentStatus}
              listening={conversationActive}
              level={level}
              partial={conversationActive ? partial : ""}
              aiWriting={canvasAiWriting || mapLoading}
              insight={passiveInsight}
              agentDockCollapsed={agentDockCollapsed}
              onToggleListening={toggleAgentConversation}
              onPromptAgent={promptAgent}
              onToggleAgentDock={() => setAgentDockCollapsed((value) => !value)}
              onExpandAudio={() => setAudioCollapsed(false)}
              onInlineDictationStart={startInlineDictation}
              onInlineDictationStop={stopInlineDictation}
            />
            {/* AI status indicators — pinned inside the canvas, above the lower chrome. */}
            {canvasStatusItems.length > 0 && (
              <div className="pointer-events-none absolute bottom-24 left-5 z-20 flex max-w-[360px] flex-col items-start gap-1.5">
                {canvasStatusItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex max-w-full items-center gap-2 px-1 text-xs font-medium text-secondary"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
                    <span className="truncate">{item.text}</span>
                  </div>
                ))}
              </div>
            )}
            {quietInsight?.emit && (
              <div className="absolute bottom-28 left-5 z-20 w-[340px] max-w-[calc(100%-40px)] text-xs text-secondary">
                <div className="mb-1 font-semibold text-primary">{quietInsight.title}</div>
                <div className="leading-relaxed">{quietInsight.observation}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addQuietInsightCard}
                    className="rounded px-2 py-1 text-[11px] font-medium text-primary hover:bg-surface-variant"
                  >
                    Add as question
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuietInsight(null)}
                    className="rounded px-2 py-1 text-[11px] font-medium text-secondary hover:bg-surface-variant hover:text-primary"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
          <footer className="h-10 px-6 flex items-center justify-between border-t border-auralis text-xs text-secondary shrink-0">
            <span>
              {liveText.length} chars · {finals.length} segments · {blockCount} blocks
            </span>
            <span>
              Murmur ·{" "}
              <Link to="/" className="hover:text-primary">
                Home
              </Link>
            </span>
          </footer>
          {audioCollapsed && !boardFullscreen && (
            <div className="absolute bottom-14 right-5 z-30">
              <AgentDock
                status={agentStatus}
                listening={conversationActive}
                level={level}
                partial={conversationActive ? partial : ""}
                aiWriting={canvasAiWriting}
                insight={passiveInsight}
                disabled={!activeSessionId || captureActive}
                collapsed={agentDockCollapsed}
                onToggleListening={toggleAgentConversation}
                onPromptAgent={promptAgent}
                onToggleDock={() => setAgentDockCollapsed((value) => !value)}
                onExpandPanel={() => setAudioCollapsed(false)}
              />
            </div>
          )}
        </section>
      </main>
      {boardFullscreen && (
        <FullscreenBoard
          state={ideaCanvas}
          onChange={onCanvasChange}
          onExit={() => setBoardFullscreen(false)}
          agentStatus={agentStatus}
          listening={conversationActive}
          level={level}
          partial={conversationActive ? partial : ""}
          aiWriting={canvasAiWriting}
          insight={passiveInsight}
          captureAnchor={captureAnchor}
          captureActive={captureActive}
          onCanvasPointSelect={selectCaptureAnchor}
          agentDockCollapsed={agentDockCollapsed}
          onToggleListening={toggleAgentConversation}
          onPromptAgent={promptAgent}
          onToggleAgentDock={() => setAgentDockCollapsed((value) => !value)}
          onInlineDictationStart={startInlineDictation}
          onInlineDictationStop={stopInlineDictation}
          onExpandAudio={() => {
            setBoardFullscreen(false);
            setAudioCollapsed(false);
          }}
        />
      )}
    </div>
  );
}

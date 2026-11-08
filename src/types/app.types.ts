import type { AnswerEvidence, ChatContext } from '../../shared/chat';
export type Node = {
  id: string;
  label: string;
  type: string;
  department?: string;
  count?: number;
  degree?: number;
  group?: string;
};
export type Edge = {
  id: string;
  source: string;
  target: string;
  type: string;
  documentId: string;
  evidence: string;
  method: string;
  verified: number;
  weight?: number;
  otherEvidence?: string;
  otherDocumentId?: string;
  reason?: string;
  basis?: string;
  targetTitle?: string;
};
export type Doc = {
  id: string;
  name: string;
  title: string;
  status: string;
  text?: string;
  error?: string;
  characters?: number;
  aiStatus?: 'queued' | 'processing' | 'done' | 'error' | null;
  aiError?: string | null;
};
export type Source = { documentId: string; text: string; title: string; citation: number };
export type Generation = { provider: string; model: string; modelCalls: number };
export type Message = {
  role: string;
  text: string;
  answerKind?: 'ai' | 'system';
  generation?: Generation;
  sources?: Source[];
  evidence?: AnswerEvidence[];
  context?: ChatContext;
};
export type AppState = {
  revision: number;
  documents: { status: string; count: number }[];
  totalDocuments: number;
  readyDocuments: number;
  totalNodes: number;
  totalEdges: number;
  verifiedEdges?: number;
};
export type MapData = AppState & {
  mode: string;
  nodes: Node[];
  edges: Edge[];
  totalMatching: number;
  hasMore: boolean;
  omittedNeighbors?: number;
  derivedVisibleEdges?: number;
};
export type Relationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  documentId: string;
  method: string;
  verified: number;
  evidence: string;
  otherId: string;
  otherLabel: string;
  otherType: string;
};
export type NodeInfo = {
  node: Node;
  relationships: Relationship[];
  relatedDocuments?: Edge[];
  total: number;
  hasMore: boolean;
};
export type Jobs = {
  counts: Record<string, number>;
  remaining: number;
  retrying: number;
  current: { documentId: string; title: string; status: string } | null;
  throughputPerMinute: number;
  etaSeconds: number | null;
  paused: boolean;
};
export type MapQuery =
  | { kind: 'idle' }
  | { kind: 'overview' }
  | { kind: 'group'; group: string; label: string }
  | { kind: 'center'; id: string; label: string }
  | { kind: 'focus'; ids: string[] };

export type ChatContext = {
  question: string;
  answer?: string;
  subject?: string;
  awaitingOrganization?: boolean;
  evidence: { documentId: string; quote: string }[];
};
export type AnswerEvidence = {
  text: string;
  source: number;
  quote: string;
  documentId?: string;
  startOffset?: number;
  endOffset?: number;
};

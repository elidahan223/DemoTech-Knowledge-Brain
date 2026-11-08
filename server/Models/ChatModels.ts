import type { ChatContext } from '../../shared/chat';
export type Timings = Record<string, number>;
export type QuestionPlan = {
  question: string;
  subject: string | undefined;
  history: ChatContext;
  feedback: boolean;
  translating: boolean;
  query: string;
  currentQuestion: string;
  modelCalls: number;
  global: boolean;
  profile: boolean | undefined;
  organization: string | undefined;
  tasks?: boolean;
};
export type Evidence = { text: string; source: number; id: string };
export type ValidatedStatement = {
  text: string;
  source: number;
  quote: string;
  documentId: string;
  startOffset: number;
  endOffset: number;
};

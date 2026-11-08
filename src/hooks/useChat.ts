import { useCallback, useRef, useState } from 'react';
import type { ChatContext } from '../../shared/chat';
import { nextChatContext, sendChat } from '../services/chat.service';
import type { Message } from '../types/app.types';
type ChatEffects = {
  onError: (message: string) => void;
  onHighlights: (ids: string[]) => void;
  onFocus: (ids: string[]) => void;
};
export function useChat(effects: ChatEffects) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const callbacks = useRef(effects);
  callbacks.current = effects;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  async function send(question: string, context?: ChatContext) {
    callbacks.current.onError('');
    setBusy(true);
    try {
      const response = await sendChat(question, context);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: response.answer,
          answerKind: response.answerKind,
          generation: response.generation,
          sources: response.sources,
          evidence: response.evidence,
          context: nextChatContext(response, question),
        },
      ]);
      callbacks.current.onHighlights(response.highlighted);
      callbacks.current.onFocus(response.highlighted.slice(0, 20));
    } catch (error) {
      callbacks.current.onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  const ask = useCallback(async (question: string) => {
    if (!question.trim() || busyRef.current) return;
    busyRef.current = true;
    const previous = messagesRef.current.at(-1);
    const context = previous?.role === 'assistant' ? previous.context : undefined;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    await sendRef.current(question, context);
  }, []);
  const clear = () => {
    setMessages([]);
    callbacks.current.onHighlights([]);
  };
  return { messages, busy, ask, clear };
}

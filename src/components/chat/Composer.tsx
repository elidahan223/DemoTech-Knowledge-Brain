import { memo, useState } from 'react';
export const Composer = memo(function Composer({
  busy,
  onAsk,
}: {
  busy: boolean;
  onAsk: (q: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const send = () => {
    if (!question.trim() || busy) return;
    onAsk(question);
    setQuestion('');
  };
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="שאלה למסמכי הארגון"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="שאלו משהו על הארגון…"
        maxLength={2000}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="send" disabled={busy || !question.trim()} aria-label="שליחת שאלה">
        ↑
      </button>
      <small>⌁ המידע נשאר במחשב שלכם</small>
    </form>
  );
});

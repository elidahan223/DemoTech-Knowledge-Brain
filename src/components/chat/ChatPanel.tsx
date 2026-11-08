import { useEffect, useRef } from 'react';
import { readableSource } from '../../../shared/source-format';
import type { Message, Source } from '../../types/app.types';
import { Composer } from './Composer';
export type ChatPanelProps = {
  messages: Message[];
  busy: boolean;
  onAsk: (question: string) => void;
  onSource: (source: Source) => void;
  onClear: () => void;
};
export function ChatPanel({ messages, busy, onAsk, onSource, onClear }: ChatPanelProps) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  return (
    <section className="chat panel">
      <div className="panel-head">
        <span className="icon">✧</span>
        <div>
          <h2>שיחה עם הידע שלך</h2>
          <p>תשובות שמתחילות במקורות</p>
        </div>
        <button className="quiet" title="ניקוי שיחה" onClick={onClear}>
          ↺
        </button>
      </div>
      <div className="conversation">
        {!messages.length && (
          <div className="welcome">
            <span className="orb">✧</span>
            <h2>מה תרצו לדעת היום?</h2>
            <p>
              שאלו על תהליכים, נהלים ואנשים.
              <br />
              אמצא את המידע במסמכי הארגון.
            </p>
            <span className="eyebrow">אפשר להתחיל כאן</span>
            {[
              'איך מתבצע תהליך קליטת עובד חדש?',
              'מי מאשר רכישת מחשב ב-6,000 ש״ח?',
              'מה קוד הבקרה של נוהל הרכש?',
            ].map((q) => (
              <button key={q} disabled={busy} onClick={() => onAsk(q)}>
                {q}
                <span>↖</span>
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div className={'message ' + m.role} key={i}>
            <small>
              {m.role === 'user'
                ? 'אתם'
                : m.answerKind === 'system'
                  ? 'הודעת מערכת'
                  : '✧ DemoTech Brain'}
            </small>
            <div>{m.text}</div>
            {m.answerKind === 'ai' && m.generation && (
              <small dir="auto">AI מקומי · {m.generation.model}</small>
            )}
            {Boolean(m.evidence?.length) && (
              <details className="answer-evidence">
                <summary>ראיות מקור לתשובה</summary>
                <small>ניסוח ותרגום באמצעות AI; הציטוטים מוצגים בשפת המקור לבדיקה.</small>
                {m.evidence?.map((e, j) => (
                  <blockquote key={j} dir="auto">
                    <b>[{e.source}]</b> {readableSource(e.quote)}
                  </blockquote>
                ))}
              </details>
            )}
            {m.sources && m.sources.length > 0 && (
              <div className="sources">
                <small>מקורות שאוחזרו · לחצו לעיון</small>
                {m.sources.map((s) => (
                  <button key={s.citation} onClick={() => onSource(s)}>
                    <b>[{s.citation}]</b> {s.title}
                    <small>{s.documentId} ↗</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="loading" role="status">
            ◌ מאחזר מקורות ומנסח תשובה במודל המקומי…
          </div>
        )}
        <div ref={end} />
      </div>
      <Composer busy={busy} onAsk={(q) => onAsk(q)} />
    </section>
  );
}

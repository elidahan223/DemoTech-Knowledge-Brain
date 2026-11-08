import type { UploadProgress as Progress } from './upload-queue';
export type UploadSession = {
  progress: Progress;
  state: 'running' | 'stopping' | 'finished' | 'stopped' | 'failed';
};
export default function UploadProgress({
  session,
  onStop,
  onDismiss,
}: {
  session: UploadSession;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const { progress: p, state } = session;
  const percent = p.total ? Math.round((100 * p.handled) / p.total) : 0;
  const active = state === 'running' || state === 'stopping';
  return (
    <section className="bulk-progress" aria-label="התקדמות העלאת מסמכים">
      <div className="bulk-progress-heading">
        <strong>
          {state === 'running'
            ? 'מעביר קבצים לתור העיבוד'
            : state === 'stopping'
              ? 'מסיים את האצווה הנוכחית לפני עצירה'
              : state === 'finished'
                ? 'העברת הקבצים הסתיימה'
                : state === 'stopped'
                  ? 'העברת הקבצים נעצרה'
                  : 'העברת הקבצים הופסקה בגלל שגיאה'}
        </strong>
        {active ? (
          <button disabled={state === 'stopping'} onClick={onStop}>
            עצירה אחרי האצווה הנוכחית
          </button>
        ) : (
          <button aria-label="סגירת התקדמות ההעלאה" onClick={onDismiss}>
            ✕
          </button>
        )}
      </div>
      <progress max={p.total || 1} value={p.handled} aria-label="קבצים שטופלו בהעלאה" />
      <div className="bulk-progress-counts" role="status">
        <span>
          {p.handled.toLocaleString('he-IL')} מתוך {p.total.toLocaleString('he-IL')} קבצים ·{' '}
          {percent}%
        </span>
        <span>
          {p.queued.toLocaleString('he-IL')} נקלטו לעיבוד · {p.duplicates.toLocaleString('he-IL')}{' '}
          כבר קיימים · {p.failed.toLocaleString('he-IL')} שגיאות
        </span>
      </div>
      <p>קבצים שנקלטו ממשיכים לעבור חילוץ ואינדוקס ברקע. עצירה אינה מוחקת קבצים שכבר נקלטו.</p>
      {p.errors.length > 0 && (
        <details>
          <summary>פרטי שגיאות ({p.failed.toLocaleString('he-IL')})</summary>
          <ul>
            {p.errors.map((e, i) => (
              <li key={i}>
                <b>{e.name}</b>: {e.error}
              </li>
            ))}
          </ul>
          {p.failed > p.errors.length && <small>מוצגות {p.errors.length} השגיאות הראשונות.</small>}
        </details>
      )}
    </section>
  );
}

import { useState } from 'react';
import { eta, number } from '../../core/format';
import { api } from '../../services/api.service';
import type { Jobs } from '../../types/app.types';
export function ProcessingPanel({ jobs, onChanged }: { jobs: Jobs | null; onChanged: () => void }) {
  const [working, setWorking] = useState(false);
  if (!jobs) return null;
  const cancelled = jobs.counts.cancelled || 0,
    errors = jobs.counts.error || 0;
  if (!jobs.remaining && !cancelled && !errors) return null;
  const done = jobs.counts.done || 0,
    total = done + jobs.remaining;
  const act = async (url: string, body: unknown) => {
    setWorking(true);
    try {
      await api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onChanged();
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="processing-panel" aria-label="עיבוד מסמכים ברקע">
      <div>
        <strong>
          {jobs.remaining
            ? `עיבוד ברקע · נותרו ${number(jobs.remaining)} מסמכים`
            : 'אין מסמכים בתור'}
        </strong>
        {jobs.remaining > 0 && (
          <span>
            {jobs.paused
              ? 'העיבוד מושהה בהגדרת השרת'
              : `${jobs.throughputPerMinute} מסמכים לדקה · ${eta(jobs.etaSeconds)}`}
            {jobs.retrying > 0 && ` · ${number(jobs.retrying)} בניסיון חוזר`}
          </span>
        )}
        {jobs.current && <small>כעת: {jobs.current.title}</small>}
      </div>
      {jobs.remaining > 0 && <progress max={total || 1} value={done} aria-label="מסמכים שעובדו" />}
      <div className="processing-actions">
        {jobs.remaining > 0 && (
          <button disabled={working} onClick={() => void act('/jobs/cancel', {})}>
            ביטול המסמכים שבתור
          </button>
        )}
        {cancelled > 0 && (
          <button disabled={working} onClick={() => void act('/jobs/resume', {})}>
            חידוש {number(cancelled)} מבוטלים
          </button>
        )}
        {errors > 0 && (
          <button
            disabled={working}
            onClick={() => void act('/jobs/resume', { includeErrors: true })}
          >
            ניסיון חוזר ל־{number(errors)} שגיאות
          </button>
        )}
      </div>
      <small className="muted">
        המסמך שבעיבוד כעת יושלם; ביטול אינו מוחק קבצים או מסמכים שכבר אונדקסו.
      </small>
    </section>
  );
}

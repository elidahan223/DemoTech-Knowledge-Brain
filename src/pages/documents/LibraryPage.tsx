import { useEffect, useState } from 'react';
import { ProcessingPanel } from '../../components/documents/ProcessingPanel';
import { statusLabels } from '../../core/constants';
import { count, number } from '../../core/format';
import { useDebounced } from '../../hooks/useDebounced';
import { api } from '../../services/api.service';
import type { AppState, Doc, Jobs } from '../../types/app.types';
export function LibraryPage({
  appState,
  jobs,
  uploading,
  onUpload,
  onReplace,
  onRemove,
  onOpen,
  onJobsChanged,
}: {
  appState: AppState | null;
  jobs: Jobs | null;
  uploading: boolean;
  onUpload: () => void;
  onReplace: (id: string) => void;
  onRemove: (d: Doc) => Promise<void>;
  onOpen: (d: Doc) => void;
  onJobsChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: Doc[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const query = useDebounced(search);
  const revision = appState?.revision;
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: '100', search: query, status });
    void api<{ items: Doc[]; total: number }>('/library?' + params)
      .then((d) => {
        if (active) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [page, query, status, revision]);
  const pageCount = Math.max(1, Math.ceil((data?.total || 0) / 100));
  return (
    <main className="library">
      <div className="section-title">
        <div>
          <span className="eyebrow">ORGANIZATIONAL KNOWLEDGE</span>
          <h1>ספריית המסמכים</h1>
          <p>מקום אחד למסמכים, למקורות ולקשרים של הארגון.</p>
        </div>
        <button className="primary" disabled={uploading} onClick={onUpload}>
          {uploading ? 'מעלה…' : '+ העלאת מסמכים'}
        </button>
      </div>
      <div className="upload-info">
        DOCX, PDF ו־TXT · עד 20MB לקובץ · אפשר לבחור אלפי קבצים יחד · העלאה באצוות ועיבוד ברקע
      </div>
      <ProcessingPanel jobs={jobs} onChanged={onJobsChanged} />
      <div className="document-filters">
        <label>
          ⌕{' '}
          <input
            aria-label="חיפוש מסמכים"
            placeholder="חיפוש בכל המסמכים…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          aria-label="סינון לפי מצב"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">כל המצבים</option>
          {Object.entries(statusLabels).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span>
          {number(data?.total ?? appState?.totalDocuments ?? 0)} מסמכים ·{' '}
          {number(count(appState, 'queued'))} בתור ·{' '}
          {number(count(appState, 'processing') + count(appState, 'embedding'))} בעיבוד ·{' '}
          {number(count(appState, 'error'))} שגיאות עיבוד
        </span>
      </div>
      {error && <p className="library-empty">{error}</p>}
      <div className="document-grid">
        {data?.items.map((d) => (
          <article key={d.id}>
            <span className="file-icon">▤</span>
            <span className={'status ' + d.status}>{statusLabels[d.status] || d.status}</span>
            <h3>{d.title}</h3>
            <code>{d.id}</code>
            <small role="status">
              {d.aiStatus === 'done'
                ? 'AI מקומי: הניתוח הסתיים'
                : d.aiStatus === 'processing'
                  ? 'AI מקומי: מנתח מסמך…'
                  : d.aiStatus === 'queued'
                    ? 'AI מקומי: ממתין לניתוח'
                    : d.aiStatus === 'error'
                      ? 'AI מקומי: הניתוח נכשל'
                      : 'טרם בוצע ניתוח AI למסמך'}
            </small>
            {d.aiStatus === 'error' && <p>{d.aiError}</p>}
            <p>{d.error || `${number(d.characters || 0)} תווים במאגר המקומי`}</p>
            <div className="actions">
              <button onClick={() => onOpen(d)}>פתיחה ↗</button>
              <button
                disabled={
                  uploading ||
                  d.status === 'processing' ||
                  d.status === 'embedding' ||
                  d.status === 'queued'
                }
                onClick={() => onReplace(d.id)}
              >
                עדכון
              </button>
              <button className="danger" onClick={() => void onRemove(d)}>
                מחיקה
              </button>
            </div>
          </article>
        ))}
      </div>
      {data && !data.items.length && (
        <p className="library-empty">לא נמצאו מסמכים התואמים לחיפוש.</p>
      )}
      <nav className="library-pagination" aria-label="עמודי ספריית המסמכים">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          הקודם
        </button>
        <span>
          עמוד {page + 1} מתוך {pageCount} · עד 100 מסמכים בעמוד
        </span>
        <button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
          הבא
        </button>
      </nav>
    </main>
  );
}

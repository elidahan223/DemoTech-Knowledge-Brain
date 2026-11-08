import type { Dispatch, SetStateAction } from 'react';
import { readableSource } from '../../../shared/source-format';
import { types } from '../../core/constants';
import { number } from '../../core/format';
import { api } from '../../services/api.service';
import type { AppState, Doc, Edge, MapQuery, Node, NodeInfo, Source } from '../../types/app.types';
export type DetailsPanelProps = {
  appState: AppState | null;
  selected: Node | null;
  source: Source | null;
  nodeInfo: NodeInfo | null;
  document: Doc | null;
  busy: boolean;
  aiExtracting: boolean;
  setAiExtracting: Dispatch<SetStateAction<boolean>>;
  setSelected: Dispatch<SetStateAction<Node | null>>;
  setSource: Dispatch<SetStateAction<Source | null>>;
  refreshState: () => Promise<AppState>;
  selectEdge: (edge: Edge) => void;
  setSearch: Dispatch<SetStateAction<string>>;
  setFilter: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setMapQuery: Dispatch<SetStateAction<MapQuery>>;
};
export function DetailsPanel({
  appState,
  selected,
  source,
  nodeInfo,
  document,
  busy,
  aiExtracting,
  setAiExtracting,
  setSelected,
  setSource,
  refreshState,
  selectEdge,
  setSearch,
  setFilter,
  setError,
  setMapQuery,
}: DetailsPanelProps) {
  const relationships = nodeInfo?.relationships || [];
  return (
    <aside className="details panel">
      <div className="panel-head">
        <span className="icon">⌘</span>
        <div>
          <h2>מבט מקרוב</h2>
          <p>ההקשר שמאחורי המידע</p>
        </div>
      </div>
      {selected ? (
        <div className="detail-body">
          <span className="node-type" style={{ color: types[selected.type]?.color }}>
            {types[selected.type]?.symbol} {types[selected.type]?.label}
          </span>
          <h2>{nodeInfo?.node.label || selected.label}</h2>
          <code>{selected.id}</code>
          {source && (
            <div className="evidence">
              <h3>{source.title}</h3>
              <p>{readableSource(source.text)}</p>
            </div>
          )}
          {document && (
            <>
              <h3>תוכן המסמך</h3>
              <div className="document-text">
                {document.text || document.error || 'המסמך נמצא בעיבוד'}
              </div>
              <button
                className="extract"
                disabled={aiExtracting || busy || document.status !== 'ready'}
                onClick={async () => {
                  setAiExtracting(true);
                  try {
                    await api('/documents/' + encodeURIComponent(document.id) + '/extract', {
                      method: 'POST',
                    });
                    setSelected((s) => (s ? { ...s } : s));
                    await refreshState();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setAiExtracting(false);
                  }
                }}
              >
                {aiExtracting ? 'מחלץ קשרים…' : '✧ חילוץ ישויות באמצעות AI'}
              </button>
              <small className="muted">תוצאות AI מסומנות כלא מאומתות.</small>
            </>
          )}
          <h3>
            קשרים ומקורות <em>{number(nodeInfo?.total || 0)}</em>
          </h3>
          {nodeInfo && nodeInfo.total > 0 && (
            <button
              className="relation expand"
              onClick={() => {
                setSearch('');
                setFilter('all');
                setMapQuery({
                  kind: 'center',
                  id: selected.id,
                  label: nodeInfo.node.label || selected.label,
                });
              }}
            >
              <span>◎ הצגת הצומת והשכנים שלו במפה</span>
            </button>
          )}
          {relationships.map((e) => (
            <button
              className="relation"
              key={e.id}
              onClick={() => {
                setSelected({ id: e.otherId, label: e.otherLabel, type: e.otherType });
                setSource({
                  documentId: e.documentId,
                  title: e.verified ? 'ראיה לאזכור מפורש' : 'קשר שטרם אומת',
                  text: e.evidence,
                  citation: 0,
                });
              }}
            >
              <span>{e.otherLabel}</span>
              <small>
                {e.type} · {e.method === 'ai' ? 'חילוץ AI' : 'מפורש'} ·{' '}
                {e.verified ? 'אזכור מפורש ✓' : 'טרם אומת'}
              </small>
              <p>{e.evidence}</p>
            </button>
          ))}
          {Boolean(nodeInfo?.relatedDocuments?.length) && (
            <>
              <h3>מסמכים עם נושא או ישות משותפים</h3>
              <small className="muted">
                קשרים נגזרים מחושבים לפי דרישה; אינם עובדות מאומתות או ציון דמיון סמנטי.
              </small>
              {nodeInfo?.relatedDocuments?.map((e) => (
                <button
                  className="relation"
                  key={e.id}
                  onClick={() => {
                    selectEdge(e);
                    setSearch('');
                    setFilter('all');
                    setMapQuery({ kind: 'center', id: e.source, label: nodeInfo.node.label });
                  }}
                >
                  <span>{e.targetTitle || e.target}</span>
                  <small>
                    {e.type === 'shared_entity' ? 'ישות משותפת' : 'נושא משותף'} · נגזר, לא מאומת
                  </small>
                  <p>{e.reason}</p>
                </button>
              ))}
            </>
          )}
          {nodeInfo?.hasMore && (
            <small className="muted">
              מוצגים {relationships.length} הקשרים הראשונים מתוך {number(nodeInfo.total)}.
            </small>
          )}
        </div>
      ) : (
        <div className="empty-detail">
          <div>⌘</div>
          <h3>כל חיבור מספר סיפור</h3>
          <p>
            בחרו צומת במפה כדי לגלות
            <br />
            מסמכים, קשרים ומקורות.
          </p>
          <div className="stats">
            <b>{number(appState?.readyDocuments || 0)}</b>
            <span>מסמכים זמינים לחיפוש</span>
            <b>{number(appState?.verifiedEdges || 0)}</b>
            <span>קשרים עם ראיות מקור</span>
          </div>
        </div>
      )}
      <div className="detail-footer">
        <i /> סביבת עבודה מקומית · DemoTech
      </div>
    </aside>
  );
}

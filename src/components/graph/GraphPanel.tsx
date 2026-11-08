import type cytoscape from 'cytoscape';
import React, { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { types } from '../../core/constants';
import { number } from '../../core/format';
import type { Graph3DControls } from '../../KnowledgeGraph3D';
import type { AppState, Edge, MapData, MapQuery, Node } from '../../types/app.types';
const KnowledgeGraph3D = React.lazy(() => import('../../KnowledgeGraph3D'));
export type GraphPanelProps = {
  appState: AppState | null;
  mapData: MapData | null;
  mapQuery: MapQuery;
  graphSearch: string;
  search: string;
  filter: string;
  mapOffset: number;
  graphMode: '3d' | '2d';
  uploading: boolean;
  graphNodes: Node[];
  graphEdges: Edge[];
  highlights: string[];
  selected: Node | null;
  view: string;
  viewKey: string;
  trail: string | null;
  spatial: RefObject<Graph3DControls | null>;
  canvas: RefObject<HTMLDivElement | null>;
  cy: RefObject<cytoscape.Core | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  loadMap: (offset?: number) => Promise<void>;
  selectNode: (node: Node) => void;
  selectEdge: (edge: Edge) => void;
  fallback2D: () => void;
  setSearch: Dispatch<SetStateAction<string>>;
  setFilter: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setMapQuery: Dispatch<SetStateAction<MapQuery>>;
  setMapOffset: Dispatch<SetStateAction<number>>;
  setGraphMode: Dispatch<SetStateAction<'3d' | '2d'>>;
  setReplaceId: Dispatch<SetStateAction<string | null>>;
};
export function GraphPanel({
  appState,
  mapData,
  mapQuery,
  graphSearch,
  search,
  filter,
  mapOffset,
  graphMode,
  uploading,
  graphNodes,
  graphEdges,
  highlights,
  selected,
  view,
  viewKey,
  trail,
  spatial,
  canvas,
  cy,
  fileInput,
  loadMap,
  selectNode,
  selectEdge,
  fallback2D,
  setSearch,
  setFilter,
  setError,
  setMapQuery,
  setMapOffset,
  setGraphMode,
  setReplaceId,
}: GraphPanelProps) {
  return (
    <section className="graph-panel">
      <div className="graph-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h1>
            מפת הידע הארגונית <span>LIVE</span>
          </h1>
          <p>
            {number(appState?.totalNodes || 0)} צמתים <b>·</b> {number(appState?.totalEdges || 0)}{' '}
            קשרים <b>·</b> מוצגים {number(graphNodes.length)}
          </p>
        </div>
        <button
          className="add-doc"
          disabled={uploading}
          onClick={() => {
            setReplaceId(null);
            fileInput.current?.click();
          }}
        >
          + מסמך חדש
        </button>
      </div>
      <div className="graph-toolbar">
        <div className="graph-view-toggle" role="group" aria-label="סוג תצוגת הגרף">
          <button
            aria-label="גרף תלת־ממדי"
            aria-pressed={graphMode === '3d'}
            onClick={() => setGraphMode('3d')}
          >
            3D
          </button>
          <button
            aria-label="גרף דו־ממדי"
            aria-pressed={graphMode === '2d'}
            onClick={() => setGraphMode('2d')}
          >
            2D
          </button>
        </div>
        <label>
          ⌕{' '}
          <input
            aria-label="חיפוש בגרף"
            placeholder="חיפוש במפת הידע…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="סינון סוג צומת"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">כל סוגי הידע</option>
          {Object.entries(types)
            .filter(([k]) => k !== 'community')
            .map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
        </select>
      </div>
      {trail && (
        <div className="map-trail" role="navigation" aria-label="מיקום במפה">
          <button
            onClick={() => {
              setSearch('');
              setFilter('all');
              setMapQuery({ kind: 'overview' });
            }}
          >
            ⬢ סקירת הקבוצות
          </button>
          <span>›</span>
          <b>{trail}</b>
          <small>
            {number(graphNodes.length)} מוצגים
            {mapData && mapData.totalMatching > graphNodes.length
              ? ` מתוך ${number(mapData.totalMatching)}`
              : ''}
          </small>
          {mapData?.hasMore && graphNodes.length < 250 && (
            <button
              onClick={() => {
                const next = mapOffset + (mapQuery.kind === 'group' ? 80 : 200);
                setMapOffset(next);
                void loadMap(next).catch((e) => setError(e.message));
              }}
            >
              טעינת עוד
            </button>
          )}
        </div>
      )}
      {graphMode === '3d' ? (
        <React.Suspense
          fallback={
            <div className="graph-loading" role="status">
              ◌ טוען את מרחב הידע התלת־ממדי…
            </div>
          }
        >
          <KnowledgeGraph3D
            ref={spatial}
            nodes={graphNodes}
            edges={graphEdges}
            highlights={highlights}
            selectedId={selected?.id}
            active={view === 'brain'}
            viewKey={viewKey}
            types={types}
            onSelectNode={selectNode}
            onSelectEdge={selectEdge}
            onFallback={fallback2D}
          />
        </React.Suspense>
      ) : (
        <div ref={canvas} className="graph-canvas" />
      )}
      <div className="map-bottom">
        <div className="legend">
          {Object.entries(types).map(([key, t]) => (
            <button
              className={filter === key ? 'chosen' : ''}
              key={key}
              disabled={key === 'community'}
              onClick={() => setFilter(filter === key ? 'all' : key)}
            >
              <i style={{ background: t.color }} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="zoom">
          <button
            aria-label="הגדלה"
            onClick={() =>
              graphMode === '3d'
                ? spatial.current?.zoom(0.8)
                : cy.current?.zoom(cy.current.zoom() * 1.2)
            }
          >
            +
          </button>
          <button
            aria-label="הקטנה"
            onClick={() =>
              graphMode === '3d'
                ? spatial.current?.zoom(1.25)
                : cy.current?.zoom(cy.current.zoom() / 1.2)
            }
          >
            −
          </button>
          <button
            onClick={() =>
              graphMode === '3d' ? spatial.current?.fit() : cy.current?.fit(undefined, 55)
            }
          >
            התאמה
          </button>
        </div>
      </div>
      <div className="graph-note">
        {mapData?.mode === 'focused-empty' && (
          <span>בחרו מסמך בספרייה או חפשו במפה כדי להציג קשרים רלוונטיים.</span>
        )}
        <span>
          מוצגים {number(graphEdges.filter((e) => e.method !== 'derived').length)} מתוך{' '}
          {number(appState?.totalEdges || 0)} קשרים שמורים ·{' '}
          {number(mapData?.derivedVisibleEdges || 0)} קשרים נגזרים
          {Boolean(mapData?.omittedNeighbors) &&
            ` · ${number(mapData!.omittedNeighbors!)} שכנים נוספים מחוץ לתצוגה`}
        </span>
        {mapData?.mode === 'overview' && (
          <span>המאגר מוצג כקבוצות ידע · לחצו על קבוצה לפתיחתה</span>
        )}
        {highlights.length
          ? `✦ ${highlights.length} מסמכים שאוחזרו מודגשים בגרף`
          : graphMode === '3d'
            ? 'סובבו את מרחב הידע · לחצו על צומת או קשר לחקירה'
            : 'לחצו על צומת לחקירה · גררו להזזה · גללו לשינוי קנה מידה'}
        <span>קו מקווקו = קשר שטרם אומת</span>
      </div>
    </section>
  );
}

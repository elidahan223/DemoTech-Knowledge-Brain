import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { types } from './core/constants';
import { number } from './core/format';
import { useChat } from './hooks/useChat';
import { useDebounced } from './hooks/useDebounced';
import { BrainPage } from './pages/brain/BrainPage';
import { LibraryPage } from './pages/documents/LibraryPage';
import { api } from './services/api.service';
import { mapUrl } from './services/map.service';
import type {
  AppState,
  Doc,
  Edge,
  Jobs,
  MapData,
  MapQuery,
  Node,
  NodeInfo,
  Source,
} from './types/app.types';

import cytoscape from 'cytoscape';
import type { Graph3DControls } from './KnowledgeGraph3D';

import { uploadFiles, type UploadReceipt } from './upload-queue';
import UploadProgress, { type UploadSession } from './UploadProgress';

/** Typing re-renders only this component, not the graph and the panels. */

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [mapQuery, setMapQuery] = useState<MapQuery>({ kind: 'overview' });
  const [mapOffset, setMapOffset] = useState(0);
  const [selected, setSelected] = useState<Node | null>(null);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [document, setDocument] = useState<Doc | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [view, setView] = useState('brain');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [highlights, setHighlights] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<{
    repository?: string;
    ollama: {
      online: boolean;
      available: boolean;
      model: string;
      embedding?: { configured: boolean; available: boolean; model: string | null };
    };
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aiExtracting, setAiExtracting] = useState(false);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<'3d' | '2d'>('3d');
  const spatial = useRef<Graph3DControls>(null);
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null);
  const uploadControl = useRef<AbortController | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const graphSearch = useDebounced(search, 300);
  const lastMapRevision = useRef(0);
  const lastMapFetch = useRef(0);
  const mapRequest = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Polling: a 0.4 KB state document every 5 s. Data is re-fetched only when the revision changes.
  // (The previous version downloaded the whole graph and document list every 6 s: ~11 MB per 30 s with 3,000 documents.)
  const refreshState = useCallback(async () => {
    const s = await api<AppState>('/state');
    setAppState((old) =>
      old && old.revision === s.revision && old.totalDocuments === s.totalDocuments ? old : s,
    );
    const j = await api<Jobs>('/jobs/summary');
    setJobs(j);
    return s;
  }, []);
  const refreshHealth = useCallback(async () => setHealth(await api<typeof health>('/health')), []);
  useEffect(() => {
    void refreshState().catch((e) => setError(e.message));
    void refreshHealth().catch(() => {});
    const a = setInterval(() => {
      if (!window.document.hidden) void refreshState().catch(() => {});
    }, 5000);
    const b = setInterval(() => {
      if (!window.document.hidden) void refreshHealth().catch(() => {});
    }, 30000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refreshState, refreshHealth]);

  const loadMap = useCallback(
    async (offset = 0) => {
      const request = ++mapRequest.current;
      const data = await api<MapData>(mapUrl(mapQuery, graphSearch, filter, offset));
      if (request !== mapRequest.current) return;
      lastMapFetch.current = Date.now();
      lastMapRevision.current = data.revision;
      setMapData((old) => {
        if (offset && old) {
          const seen = new Set(old.nodes.map((n) => n.id));
          const nodes = [...old.nodes, ...data.nodes.filter((n) => !seen.has(n.id))].slice(0, 250);
          const ids = new Set(nodes.map((n) => n.id));
          const edgeIds = new Set(old.edges.map((e) => e.id));
          return {
            ...data,
            nodes,
            edges: [
              ...old.edges,
              ...data.edges.filter(
                (e) => !edgeIds.has(e.id) && ids.has(e.source) && ids.has(e.target),
              ),
            ],
          };
        }
        // Keep the same object when nothing changed so the graph does not re-layout.
        if (
          old &&
          old.mode === data.mode &&
          old.nodes.length === data.nodes.length &&
          old.edges.length === data.edges.length &&
          old.nodes.every((n, i) => n.id === data.nodes[i].id && n.label === data.nodes[i].label) &&
          old.edges.every(
            (e, i) =>
              e.id === data.edges[i].id &&
              e.verified === data.edges[i].verified &&
              e.source === data.edges[i].source &&
              e.target === data.edges[i].target &&
              e.type === data.edges[i].type &&
              e.weight === data.edges[i].weight,
          )
        )
          return { ...old, ...data, nodes: old.nodes, edges: old.edges };
        return data;
      });
    },
    [mapQuery, graphSearch, filter],
  );
  useEffect(() => {
    setMapOffset(0);
    void loadMap().catch((e) => setError(e.message));
  }, [loadMap]);
  // While documents are being indexed the overview changes constantly; refresh it at most every 20 s, and only when visible.
  useEffect(() => {
    if (
      !appState ||
      viewRef.current !== 'brain' ||
      appState.revision === lastMapRevision.current ||
      Date.now() - lastMapFetch.current < 20000
    )
      return;
    if (mapQuery.kind !== 'overview' && mapQuery.kind !== 'group') return;
    void loadMap().catch(() => {});
  }, [appState, loadMap, mapQuery.kind]);

  // Node details are fetched for the selected node only (the previous version filtered every edge in the browser).
  useEffect(() => {
    setNodeInfo(null);
    setDocument(null);
    if (!selected || selected.type === 'community') return;
    let active = true;
    void api<NodeInfo>('/nodes/' + encodeURIComponent(selected.id))
      .then((d) => {
        if (active) setNodeInfo(d);
      })
      .catch(() => {});
    if (selected.type === 'document')
      void api<Doc>('/documents/' + encodeURIComponent(selected.id))
        .then((d) => {
          if (active) setDocument(d);
        })
        .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [selected]);
  useEffect(() => {
    if (!document || document.status === 'ready' || !selected) return;
    void api<Doc>('/documents/' + encodeURIComponent(selected.id))
      .then(setDocument)
      .catch(() => {});
  }, [appState?.revision]);

  const graphNodes = mapData?.nodes || [];
  const graphEdges = mapData?.edges || [];
  const visibleIds = useMemo(() => new Set(graphNodes.map((n) => n.id)), [graphNodes]);
  const viewKey =
    graphSearch.trim() || filter !== 'all'
      ? `search:${filter}:${graphSearch}`
      : mapQuery.kind === 'idle'
        ? 'idle'
        : mapQuery.kind === 'overview'
          ? 'overview'
          : mapQuery.kind === 'group'
            ? 'group:' + mapQuery.group
            : mapQuery.kind === 'center'
              ? 'center:' + mapQuery.id
              : 'focus:' + mapQuery.ids.join(',');

  const selectNode = useCallback((node: Node) => {
    if (node.type === 'community' && node.group) {
      setMapQuery({ kind: 'group', group: node.group, label: node.label });
      setSearch('');
      setFilter('all');
      setSelected(null);
      setSource(null);
      return;
    }
    setSelected(node);
    setSource(null);
  }, []);
  const selectEdge = useCallback((edge: Edge) => {
    setSelected({ id: edge.documentId, label: edge.documentId, type: 'document' });
    void api<Edge>('/edges/' + encodeURIComponent(edge.id))
      .then((full) =>
        setSource({
          documentId: edge.documentId,
          title:
            full.method === 'derived'
              ? 'קשר נגזר — ' + (full.reason || 'אזכור משותף')
              : edge.verified
                ? 'ראיה לאזכור מפורש'
                : 'קשר שטרם אומת',
          text:
            full.evidence +
            (full.otherEvidence
              ? `\n\nראיה מהמסמך השני (${full.otherDocumentId}):\n${full.otherEvidence}`
              : ''),
          citation: 0,
        }),
      )
      .catch((e) => setError(e.message));
  }, []);
  const fallback2D = useCallback(() => setGraphMode('2d'), []);

  // 2D graph: rebuilt only when the visible data changes; highlights are applied as classes without a new layout.
  useEffect(() => {
    if (view !== 'brain' || graphMode !== '2d' || !canvas.current) return;
    const edges = graphEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    cy.current = cytoscape({
      container: canvas.current,
      elements: [
        ...graphNodes.map((n) => ({
          data: {
            ...n,
            color: types[n.type]?.color || '#aaa',
            display: `${types[n.type]?.symbol || '●'} ${n.label}`,
          },
        })),
        ...edges.map((e) => ({ data: { ...e }, classes: !e.verified ? 'unverified' : '' })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(display)',
            'background-color': 'data(color)',
            color: '#cdd7ec',
            'font-size': 12,
            'text-valign': 'bottom',
            'text-margin-y': 9,
            width: 20,
            height: 20,
            'text-wrap': 'wrap',
            'text-max-width': '110px',
            'border-width': 5,
            'border-color': '#151e32',
          },
        },
        { selector: 'node[type="department"]', style: { shape: 'diamond', width: 33, height: 33 } },
        { selector: 'node[type="community"]', style: { shape: 'hexagon', width: 42, height: 42 } },
        { selector: 'node[type="system"]', style: { shape: 'round-rectangle' } },
        { selector: 'node[type="process"]', style: { shape: 'hexagon' } },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#39465f',
            'target-arrow-color': '#39465f',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.55,
            'curve-style': 'bezier',
            opacity: 0.5,
          },
        },
        { selector: '.unverified', style: { 'line-style': 'dashed', opacity: 0.25 } },
        {
          selector: 'node.retrieved',
          style: { 'border-color': '#bcf5cc', 'border-width': 5, width: 29, height: 29 },
        },
        { selector: 'edge.retrieved', style: { 'line-color': '#bcf5cc', width: 3, opacity: 1 } },
        { selector: ':selected', style: { 'border-color': '#fff', 'border-width': 4 } },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: () => 160000,
        idealEdgeLength: () => 130,
        gravity: 0.12,
        padding: 65,
      },
      minZoom: 0.2,
      maxZoom: 3,
    });
    cy.current.on('tap', 'node', (event) => selectNode(event.target.data()));
    cy.current.on('tap', 'edge', (event) => {
      const edge = event.target.data() as Edge;
      if (edge.type !== 'aggregate') selectEdge(edge);
    });
    return () => {
      cy.current?.destroy();
      cy.current = null;
    };
  }, [graphNodes, graphEdges, view, graphMode]);
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    const active = new Set(highlights);
    c.batch(() => {
      c.nodes().forEach((n) => {
        n.toggleClass('retrieved', active.has(n.id()));
      });
      c.edges().forEach((e) => {
        e.toggleClass(
          'retrieved',
          active.has(e.data('source')) && active.has(e.data('target')) && !!e.data('verified'),
        );
      });
    });
  }, [highlights, graphNodes, graphMode]);

  function focusOn(ids: string[]) {
    if (ids.length && ids.some((id) => !visibleIds.has(id))) {
      setSearch('');
      setFilter('all');
      setMapQuery({ kind: 'focus', ids });
    }
  }
  function openSource(s: Source) {
    setSource(s);
    setSelected({ id: s.documentId, label: s.title, type: 'document' });
    focusOn([s.documentId]);
    setView('brain');
  }
  const {
    messages,
    busy,
    ask,
    clear: clearChat,
  } = useChat({ onError: setError, onHighlights: setHighlights, onFocus: focusOn });
  async function upload(files: FileList | null) {
    if (!files?.length || uploadControl.current) return;
    const control = new AbortController();
    uploadControl.current = control;
    setUploading(true);
    setError('');
    try {
      const result = await uploadFiles(Array.from(files), {
        signal: control.signal,
        replaceId: replaceId || undefined,
        send: (body) => api<UploadReceipt[]>('/documents', { method: 'POST', body }),
        onProgress: (progress) =>
          setUploadSession({ progress, state: control.signal.aborted ? 'stopping' : 'running' }),
      });
      setUploadSession({
        progress: result.progress,
        state: result.stopped ? 'stopped' : 'finished',
      });
    } catch (e) {
      setError((e as Error).message);
      setUploadSession((old) => (old ? { ...old, state: 'failed' } : null));
    } finally {
      uploadControl.current = null;
      setUploading(false);
      setReplaceId(null);
      if (fileInput.current) fileInput.current.value = '';
      await refreshState().catch((e) => setError(e.message));
    }
  }
  async function remove(doc: Doc) {
    if (!window.confirm(`למחוק את "${doc.title}" ואת האינדקס והקשרים שלו?`)) return;
    try {
      await api('/documents/' + encodeURIComponent(doc.id), { method: 'DELETE' });
      if (selected?.id === doc.id) setSelected(null);
      await refreshState();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const trail =
    graphSearch.trim() || filter !== 'all'
      ? 'תוצאות חיפוש וסינון'
      : mapQuery.kind === 'group'
        ? mapQuery.label
        : mapQuery.kind === 'center'
          ? `שכנים של ${mapQuery.label}`
          : mapQuery.kind === 'focus'
            ? 'מקורות התשובה והקשרים שלהם'
            : null;
  return (
    <div className="app">
      <header>
        <a className="brand" href="#" onClick={() => setView('brain')}>
          <span className="brandmark">✳</span>
          <span>
            DemoTech <b>Knowledge Brain</b>
            <small>הידע של הארגון. מחובר.</small>
          </span>
        </a>
        <nav>
          <button className={view === 'brain' ? 'active' : ''} onClick={() => setView('brain')}>
            ◉ המוח הארגוני
          </button>
          <button
            className={view === 'documents' ? 'active' : ''}
            onClick={() => setView('documents')}
          >
            ▤ ספריית מסמכים <em>{number(appState?.totalDocuments || 0)}</em>
          </button>
        </nav>
        <span className="local">
          <i className={health?.ollama.available ? 'online' : ''} />{' '}
          {health?.ollama.available ? 'מודל מקומי מחובר' : 'המודל לא זמין'}
          <small>{health?.repository || 'LOCAL WORKSPACE'}</small>
        </span>
      </header>
      <input
        ref={fileInput}
        type="file"
        multiple={!replaceId}
        accept=".docx,.pdf,.txt"
        hidden
        onChange={(e) => void upload(e.target.files)}
      />
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}
      {uploadSession && (
        <UploadProgress
          session={uploadSession}
          onStop={() => {
            uploadControl.current?.abort();
            setUploadSession((old) => (old ? { ...old, state: 'stopping' } : null));
          }}
          onDismiss={() => setUploadSession(null)}
        />
      )}
      {health && !health.ollama.available && (
        <div className="ollama-notice" role="status">
          <div>
            <strong>
              {!health.ollama.online ? 'שירות Ollama אינו פעיל' : 'המודל הדרוש אינו מותקן ב־Ollama'}
            </strong>
            <span>
              {!health.ollama.online
                ? 'פתחו את Ollama במחשב ואז לחצו על בדיקה חוזרת. האפליקציה אינה מפעילה אותו אוטומטית.'
                : `המודל ${health.ollama.model} אינו זמין. יש להתקין אותו ב־Ollama; הורדה ראשונית דורשת חיבור לאינטרנט.`}{' '}
              אפשר להמשיך לעיין במסמכים ובגרף.
            </span>
          </div>
          <button onClick={() => void refreshHealth().catch((e) => setError(e.message))}>
            בדיקה חוזרת
          </button>
        </div>
      )}
      {health?.ollama.online &&
        health.ollama.embedding?.configured &&
        !health.ollama.embedding.available && (
          <div className="ollama-notice" role="status">
            <div>
              <strong>מודל ה-Embeddings המקומי אינו זמין</strong>
              <span>
                נדרש המודל {health.ollama.embedding.model} לצורך אינדוקס וחיפוש סמנטי. אין מעבר שקט
                לתשובה חלופית.
              </span>
            </div>
          </div>
        )}
      {view === 'documents' && (
        <LibraryPage
          appState={appState}
          jobs={jobs}
          uploading={uploading}
          onUpload={() => {
            setReplaceId(null);
            fileInput.current?.click();
          }}
          onReplace={(id) => {
            setReplaceId(id);
            fileInput.current?.click();
          }}
          onRemove={remove}
          onOpen={(d) => {
            setSelected({ id: d.id, label: d.title, type: 'document' });
            setSource(null);
            focusOn([d.id]);
            setView('brain');
          }}
          onJobsChanged={() => void refreshState()}
        />
      )}
      {/* The brain view stays mounted while the library is open: camera, layout and GPU resources are kept and rendering is paused. */}
      <BrainPage
        active={view === 'brain'}
        chat={{ messages, busy, onAsk: ask, onSource: openSource, onClear: clearChat }}
        graph={{
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
        }}
        details={{
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
        }}
      />
      <footer>
        <span>
          DemoTech Knowledge Brain <b> / </b> סביבת הדגמה מקומית
        </span>
        <span>
          SQLite FTS5 <b>·</b> {health?.ollama.model || 'Ollama'} <b>·</b> ללא שירותי AI חיצוניים
        </span>
      </footer>
    </div>
  );
}

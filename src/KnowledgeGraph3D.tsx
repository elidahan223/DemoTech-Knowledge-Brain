import ForceGraph3D, {
  type ForceGraph3DInstance,
  type LinkObject,
  type NodeObject,
} from '3d-force-graph';
import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PerspectiveCamera } from 'three';
import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshPhongMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import SpriteText from 'three-spritetext';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRAPH_LABEL_LIMIT, GRAPH_VIEW_LIMIT } from '../shared/graph-policy';
import type { LayoutRequest, LayoutResult } from './layout.worker';

type GraphNode = {
  id: string;
  label: string;
  type: string;
  department?: string;
  count?: number;
  degree?: number;
  group?: string;
};
type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  documentId: string;
  evidence: string;
  method: string;
  verified: number;
  weight?: number;
};
type SceneNode = GraphNode & NodeObject;
type SceneEdge = Omit<GraphEdge, 'source' | 'target'> &
  LinkObject<SceneNode> & { sourceId: string; targetId: string; __lineObj?: Object3D };
type NodeVisual = { group: Group; core: Mesh; halo: Sprite; label?: SpriteText; scale: number };
type Types = Record<string, { label: string; color: string; symbol: string }>;
type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlights: string[];
  selectedId?: string;
  active: boolean;
  viewKey: string;
  types: Types;
  onSelectNode: (node: GraphNode) => void;
  onSelectEdge: (edge: GraphEdge) => void;
  onFallback: () => void;
};
export type Graph3DControls = { zoom: (factor: number) => void; fit: () => void };

// Survive unmounts (2D/3D toggle, view switches): positions are reused instead of recomputed, and the camera is restored.
const positionCache = new Map<string, [number, number, number]>();
let savedCamera:
  | { viewKey: string; position: [number, number, number]; target: [number, number, number] }
  | undefined;
function remember(id: string, p: [number, number, number]) {
  positionCache.delete(id);
  positionCache.set(id, p);
  if (positionCache.size > 6000) positionCache.delete(positionCache.keys().next().value!);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const fill = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  fill.addColorStop(0, 'rgba(255,255,255,0.95)');
  fill.addColorStop(0.18, 'rgba(255,255,255,0.4)');
  fill.addColorStop(0.48, 'rgba(255,255,255,0.09)');
  fill.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}
function wrapLabel(text: string) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length > 18) {
      lines.push(line);
      line = word;
    } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join('\n');
}
function tooltip(text: string) {
  const el = document.createElement('div');
  el.className = 'graph-tooltip';
  el.dir = 'rtl';
  el.textContent = text;
  return el;
}

/**
 * GPU resources shared by every node and link: one geometry per node type, a handful of materials and one glow texture.
 * The profile of the previous version spent ~3.4 s of 13 s active CPU in per-object uniform uploads because every node
 * had its own geometry, materials and two canvas textures. 3d-force-graph disposes the resources of removed objects,
 * so shared ones are protected and released explicitly on unmount.
 */
function createResources(types: Types) {
  const release: (() => void)[] = [];
  function shared<T extends { dispose: () => void }>(resource: T): T {
    const dispose = resource.dispose.bind(resource);
    release.push(dispose);
    resource.dispose = () => {};
    return resource;
  }
  const glow = shared(glowTexture());
  const geometries: Record<string, BufferGeometry> = {
    document: shared(new SphereGeometry(4, 14, 10)),
    person: shared(new SphereGeometry(4.8, 14, 10)),
    department: shared(new OctahedronGeometry(6)),
    system: shared(new BoxGeometry(7, 7, 7)),
    process: shared(new IcosahedronGeometry(4.4)),
    community: shared(new DodecahedronGeometry(7.5)),
  };
  const cores = new Map<string, MeshPhongMaterial>(),
    halos = new Map<string, SpriteMaterial>(),
    lines = new Map<string, LineBasicMaterial>();
  const color = (type: string) => types[type]?.color || '#9bacd1';
  const dashed = shared(
    new LineDashedMaterial({
      color: '#ad8e6d',
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.6,
    }),
  );
  return {
    geometry: (type: string) => geometries[type] || geometries.document,
    core(type: string, bright: boolean) {
      const key = type + bright;
      let m = cores.get(key);
      if (!m) {
        const c = bright ? '#d8ffed' : color(type);
        m = shared(
          new MeshPhongMaterial({
            color: c,
            emissive: bright ? '#69e1bb' : c,
            emissiveIntensity: bright ? 0.85 : 0.24,
            shininess: 80,
          }),
        );
        cores.set(key, m);
      }
      return m;
    },
    halo(type: string, bright: boolean) {
      const key = type + bright;
      let m = halos.get(key);
      if (!m) {
        m = shared(
          new SpriteMaterial({
            map: glow,
            color: bright ? '#91f5ce' : color(type),
            transparent: true,
            opacity: bright ? 0.65 : 0.34,
            depthWrite: false,
            blending: AdditiveBlending,
          }),
        );
        halos.set(key, m);
      }
      return m;
    },
    line(hex: string, opacity = 0.56) {
      const key = hex + opacity;
      let m = lines.get(key);
      if (!m) {
        m = shared(
          new LineBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false }),
        );
        lines.set(key, m);
      }
      return m;
    },
    dashed,
    dispose() {
      for (const dispose of release.splice(0)) dispose();
      cores.clear();
      halos.clear();
      lines.clear();
    },
  };
}
/** Releases every geometry, material and texture still referenced by the scene (labels, arrows, link geometries). */
function disposeScene(root: Object3D) {
  const seen = new Set<{ dispose: () => void }>();
  root.traverse((object) => {
    const o = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (o.geometry) seen.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      seen.add(m);
      for (const value of Object.values(m))
        if ((value as Texture)?.isTexture) seen.add(value as Texture);
    }
  });
  for (const r of seen) r.dispose();
}

const KnowledgeGraph3D = memo(
  forwardRef<Graph3DControls, Props>(function KnowledgeGraph3D(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const graph = useRef<ForceGraph3DInstance<SceneNode, SceneEdge> | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const resources = useRef<ReturnType<typeof createResources> | null>(null);
    const visuals = useRef(new Map<string, NodeVisual>());
    const sceneNodes = useRef(new Map<string, SceneNode>());
    const [failure, setFailure] = useState('');
    const [rotating, setRotating] = useState(false);
    const [labels, setLabels] = useState(true);
    const [hovered, setHovered] = useState<string | null>(null);
    const display = useRef({ rotating: false, labels: true, hovered: null as string | null });
    display.current = { rotating, labels, hovered };
    const fitted = useRef(false);
    const fitFrame = useRef<number | undefined>(undefined);
    const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const engineRunning = useRef(false);
    const awakeUntil = useRef(0);
    const sleepTimer = useRef<number | undefined>(undefined);
    const animationRunning = useRef(true);
    const worker = useRef<Worker | null>(null);
    const layoutRequest = useRef(0);
    const shownKey = useRef('');
    const shownMode = useRef('');
    const pendingFit = useRef(false);
    const plannedNodes = useRef(0);
    const [layoutMs, setLayoutMs] = useState<number | null>(null);
    const visibleNodes =
      props.nodes.length > GRAPH_VIEW_LIMIT ? props.nodes.slice(0, GRAPH_VIEW_LIMIT) : props.nodes;
    const duration = () => (reducedMotion.current ? 0 : 650);

    // Render on demand (three.js manual, "Rendering on demand"): the previous version re-rendered the whole scene every
    // frame even when nothing moved (measured 34–38% main-thread CPU while idle). The loop now runs only while something
    // changes — layout, camera transition, damping, hover, rotation or highlighted particles — and then stops.
    function particlesActive() {
      return !reducedMotion.current && latest.current.highlights.length > 0;
    }
    function wake(ms = 1200) {
      const g = graph.current;
      if (!g || !latest.current.active) return;
      awakeUntil.current = Math.max(awakeUntil.current, performance.now() + ms);
      // resumeAnimation performs a synchronous frame. OrbitControls may emit
      // change during that frame, so mark the transition before calling it.
      if (!animationRunning.current) {
        animationRunning.current = true;
        g.resumeAnimation();
      }
      if (sleepTimer.current === undefined)
        sleepTimer.current = window.setTimeout(sleepCheck, ms + 40);
    }
    function sleepCheck() {
      sleepTimer.current = undefined;
      const g = graph.current;
      if (!g) return;
      if (!latest.current.active) {
        animationRunning.current = false;
        g.pauseAnimation();
        return;
      }
      const busy = display.current.rotating || engineRunning.current || particlesActive();
      const remaining = awakeUntil.current - performance.now();
      if (busy || remaining > 0) {
        sleepTimer.current = window.setTimeout(sleepCheck, busy ? 500 : remaining + 40);
        return;
      }
      animationRunning.current = false;
      g.pauseAnimation();
    }

    function fit(transition = duration()) {
      if (fitFrame.current !== undefined) cancelAnimationFrame(fitFrame.current);
      fitFrame.current = requestAnimationFrame(() => {
        fitFrame.current = requestAnimationFrame(() => {
          const g = graph.current;
          if (!g || !host.current) return;
          if (!host.current.clientWidth) {
            pendingFit.current = true;
            return;
          }
          pendingFit.current = false;
          const points = g
            .graphData()
            .nodes.filter(
              (n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z),
            )
            .map((n) => new Vector3(n.x, n.y, n.z));
          if (!points.length) return;
          // Fit actual node positions in camera space instead of the empty corners of a 3D box.
          const center = new Box3().setFromPoints(points).getCenter(new Vector3());
          const camera = g.camera() as PerspectiveCamera;
          const back = camera.position
            .clone()
            .sub((g.controls() as OrbitControls).target)
            .normalize();
          const right = new Vector3().crossVectors(new Vector3(0, 1, 0), back).normalize();
          if (right.lengthSq() < 0.01) right.set(1, 0, 0);
          const up = new Vector3().crossVectors(back, right).normalize();
          const vertical = Math.tan((camera.fov * Math.PI) / 360) * 0.76;
          const horizontal = (vertical * host.current.clientWidth) / host.current.clientHeight;
          const distance = Math.max(
            65,
            ...points.map((p) => {
              const local = p.clone().sub(center);
              return (
                local.dot(back) +
                Math.max(
                  (Math.abs(local.dot(up)) + 12) / vertical,
                  (Math.abs(local.dot(right)) + 22) / horizontal,
                )
              );
            }),
          );
          g.cameraPosition(center.clone().add(back.multiplyScalar(distance)), center, transition);
          wake(transition + 400);
        });
      });
    }
    function zoom(factor: number) {
      const g = graph.current;
      if (!g) return;
      const target = (g.controls() as OrbitControls).target;
      const relative = g.camera().position.clone().sub(target).multiplyScalar(factor);
      relative.clampLength(28, 2400);
      g.cameraPosition(relative.add(target), target, duration());
      wake(duration() + 400);
    }
    function focusNode(node: SceneNode) {
      const g = graph.current;
      if (!g) return;
      const target = new Vector3(node.x || 0, node.y || 0, node.z || 0);
      const direction = g
        .camera()
        .position.clone()
        .sub((g.controls() as OrbitControls).target)
        .normalize();
      g.cameraPosition(target.clone().add(direction.multiplyScalar(150)), target, duration());
      wake(duration() + 400);
    }
    useImperativeHandle(ref, () => ({ zoom, fit }));

    function bright(id: string) {
      const p = latest.current;
      return p.selectedId === id || p.highlights.includes(id) || display.current.hovered === id;
    }
    // Level of detail is decided from the number of nodes being shown (objects are created asynchronously by the library).
    function needsLabel(node: GraphNode, isBright: boolean) {
      return (
        node.type === 'community' ||
        node.type === 'department' ||
        isBright ||
        (display.current.labels && plannedNodes.current <= GRAPH_LABEL_LIMIT)
      );
    }
    function syncVisual(node: GraphNode, v: NodeVisual) {
      const r = resources.current;
      if (!r) return;
      const on = bright(node.id);
      const selected = latest.current.selectedId === node.id;
      v.core.material = r.core(node.type, on);
      v.core.scale.setScalar(v.scale * (selected ? 1.35 : 1));
      v.halo.material = r.halo(node.type, on);
      v.halo.scale.setScalar((on ? 39 : 31) * v.scale);
      const show = needsLabel(node, on);
      // Labels are canvas textures: created only when first needed.
      if (show && !v.label) {
        const size = v.scale * (node.type === 'department' ? 6 : node.type === 'person' ? 4.8 : 4);
        const label = new SpriteText(
          wrapLabel(node.label),
          node.type === 'community' ? 7 : 6,
          '#b9cae8',
        );
        label.fontFace = 'Segoe UI, Arial, sans-serif';
        label.fontSize = 64;
        label.position.set(0, -(size + 8), 0);
        label.material.depthWrite = false;
        label.raycast = () => {};
        v.group.add(label);
        v.label = label;
      }
      if (v.label) {
        v.label.visible = show;
        v.label.color = on ? '#dcfff0' : '#b9cae8';
        const text = wrapLabel(node.label);
        if (v.label.text !== text) v.label.text = text;
      }
    }
    function updateVisuals() {
      for (const [id, v] of visuals.current) {
        const node = sceneNodes.current.get(id);
        if (node) syncVisual(node, v);
      }
      updateLinks();
      wake(400);
    }
    /** Link colours change by swapping shared materials in place. Calling linkColor()/linkWidth() again would make
     * 3d-force-graph rebuild every link object (the previous version did this on every hover). */
    function linkMaterialFor(edge: SceneEdge) {
      const r = resources.current!;
      const { selectedId, highlights } = latest.current;
      const answer = highlights.includes(edge.sourceId) && highlights.includes(edge.targetId);
      const near = selectedId === edge.sourceId || selectedId === edge.targetId;
      return answer
        ? r.line('#a8f5d2', 0.95)
        : near
          ? r.line('#91a7e6', 0.8)
          : edge.type === 'aggregate'
            ? r.line(
                '#6d86bd',
                Math.min(0.75, +(0.25 + 0.08 * Math.log2(1 + (edge.weight || 1))).toFixed(2)),
              )
            : r.line('#526b9c');
    }
    function updateLinks() {
      const g = graph.current;
      if (!g || !resources.current) return;
      for (const edge of g.graphData().links) {
        const line = edge.__lineObj as Line | Mesh | undefined;
        if (line && edge.verified && 'material' in line) line.material = linkMaterialFor(edge);
      }
    }

    useEffect(() => {
      if (!host.current) return;
      let alive = true;
      let instance: ForceGraph3DInstance<SceneNode, SceneEdge> | null = null;
      const element = host.current;
      function contextLost(event: Event) {
        event.preventDefault();
        if (alive) setFailure('החיבור למנוע התלת־ממד אבד. אפשר להמשיך לעבוד בתצוגת 2D.');
      }
      try {
        instance = new ForceGraph3D(element, {
          controlType: 'orbit',
          rendererConfig: { antialias: true, alpha: true, powerPreference: 'low-power' },
        }) as unknown as ForceGraph3DInstance<SceneNode, SceneEdge>;
        graph.current = instance;
        animationRunning.current = true;
        const g = instance;
        const r = createResources(latest.current.types);
        resources.current = r;
        g.width(element.clientWidth)
          .height(element.clientHeight)
          .backgroundColor('#00000000')
          .showNavInfo(false)
          .numDimensions(3)
          .warmupTicks(0)
          .cooldownTicks(2)
          .d3VelocityDecay(0.36)
          .nodeRelSize(3)
          .nodeId('id')
          .nodeLabel((n) =>
            tooltip(
              n.type === 'community'
                ? `${n.label}\nלחצו לפתיחת הקבוצה`
                : `${n.label} · ${latest.current.types[n.type]?.label || n.type}\n${n.id}`,
            ),
          )
          .linkLabel((e) =>
            tooltip(
              e.type === 'aggregate'
                ? `${e.weight} קשרים בין הקבוצות`
                : `${e.type} · ${e.verified ? 'אזכור מפורש' : 'טרם אומת'}`,
            ),
          )
          .nodeThreeObject((n) => {
            const scale =
              n.type === 'community'
                ? 1 + Math.log10(Math.max(1, n.count || 1)) / 1.4
                : n.degree
                  ? 1 + Math.log10(n.degree) / 3
                  : 1;
            const group = new Group();
            const core = new Mesh(r.geometry(n.type), r.core(n.type, false));
            core.scale.setScalar(scale);
            group.add(core);
            const halo = new Sprite(r.halo(n.type, false));
            halo.scale.setScalar(31 * scale);
            halo.raycast = () => {};
            group.add(halo);
            const visual = { group, core, halo, scale };
            visuals.current.set(n.id, visual);
            syncVisual(n, visual);
            wake(300);
            return group;
          })
          .linkWidth(0)
          .linkOpacity(0.56)
          .linkHoverPrecision(3)
          .linkCurvature(0)
          .linkMaterial((e) => (e.verified ? linkMaterialFor(e) : null!))
          .linkDirectionalArrowRelPos(0.82)
          .linkDirectionalArrowColor('#687fa8')
          .linkDirectionalParticleWidth(1.4)
          .linkDirectionalParticleColor('#b6ffdd')
          .linkDirectionalParticleSpeed(0.003)
          .linkThreeObject((e) => {
            if (e.verified) return null!;
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
            return new Line(geometry, r.dashed);
          })
          .linkPositionUpdate((object, coords, edge) => {
            if (edge.verified) return false;
            const line = object as Line;
            const p = line.geometry.getAttribute('position') as BufferAttribute;
            p.setXYZ(0, coords.start.x, coords.start.y, coords.start.z);
            p.setXYZ(1, coords.end.x, coords.end.y, coords.end.z);
            p.needsUpdate = true;
            line.geometry.computeBoundingSphere();
            line.computeLineDistances();
            return true;
          })
          .onNodeClick((node) => {
            latest.current.onSelectNode(node);
            if (node.type !== 'community') focusNode(node);
          })
          .onNodeHover((node) => {
            if (alive) setHovered(node?.id || null);
            element.style.cursor = node ? 'pointer' : 'grab';
          })
          .onNodeDrag(() => wake(800))
          .onNodeDragEnd((node) => {
            node.fx = node.x;
            node.fy = node.y;
            node.fz = node.z;
            remember(node.id, [node.x || 0, node.y || 0, node.z || 0]);
          })
          .onLinkClick((edge) => {
            if (edge.type === 'aggregate') return;
            const raw = latest.current.edges.find((e) => e.id === edge.id);
            if (raw) latest.current.onSelectEdge(raw);
          })
          .onEngineStop(() => {
            engineRunning.current = false;
          });
        g.d3Force('charge')?.strength(-150);
        g.d3Force('link')?.distance(48);
        const controls = g.controls() as OrbitControls;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotateSpeed = 0.55;
        controls.minDistance = 28;
        controls.maxDistance = 2400;
        controls.addEventListener('change', () => wake(250));
        if (savedCamera && savedCamera.viewKey === latest.current.viewKey) {
          g.camera().position.set(...savedCamera.position);
          controls.target.set(...savedCamera.target);
          controls.update();
          fitted.current = true;
        } else g.cameraPosition({ x: 155, y: 100, z: 215 });
        g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        const canvas = g.renderer().domElement;
        canvas.addEventListener('webglcontextlost', contextLost);
        const pointer = () => wake(1500);
        for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown'])
          element.addEventListener(type, pointer, { passive: true });
        // Resizing keeps the user's camera; a fit is only replayed if it was requested while the view was hidden.
        const observer = new ResizeObserver(() => {
          if (alive && element.clientWidth && element.clientHeight) {
            g.width(element.clientWidth).height(element.clientHeight);
            if (pendingFit.current) fit(0);
            wake(300);
          }
        });
        observer.observe(element);
        const visibility = () => {
          if (document.hidden) {
            animationRunning.current = false;
            g.pauseAnimation();
          } else wake(500);
        };
        document.addEventListener('visibilitychange', visibility);
        try {
          worker.current = new Worker(new URL('./layout.worker.ts', import.meta.url), {
            type: 'module',
          });
        } catch (error) {
          console.warn('Layout worker unavailable; using the in-page layout', error);
          worker.current = null;
        }
        wake(800);
        return () => {
          alive = false;
          const camera = g.camera(),
            target = controls.target;
          savedCamera = {
            viewKey: latest.current.viewKey,
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: [target.x, target.y, target.z],
          };
          if (fitFrame.current !== undefined) cancelAnimationFrame(fitFrame.current);
          window.clearTimeout(sleepTimer.current);
          sleepTimer.current = undefined;
          worker.current?.terminate();
          worker.current = null;
          observer.disconnect();
          document.removeEventListener('visibilitychange', visibility);
          canvas.removeEventListener('webglcontextlost', contextLost);
          for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown'])
            element.removeEventListener(type, pointer);
          // Free GPU memory: scene resources, shared resources, then the WebGL context itself.
          const scene = g.scene();
          g._destructor();
          disposeScene(scene);
          r.dispose();
          g.renderer().dispose();
          g.renderer().forceContextLoss();
          graph.current = null;
          resources.current = null;
          visuals.current.clear();
          sceneNodes.current.clear();
          fitted.current = false;
          shownKey.current = '';
          element.replaceChildren();
        };
      } catch (error) {
        instance?._destructor();
        graph.current = null;
        if (alive)
          setFailure('מנוע התלת־ממד אינו זמין במחשב זה. ניתן לעבור לגרף הדו־ממדי ולהמשיך לעבוד.');
        console.warn('3D graph unavailable', error);
      }
      return () => {
        alive = false;
      };
    }, []);

    // Data changes: lay out new nodes in the worker (known nodes keep their position), then hand fixed positions to the scene.
    useEffect(() => {
      const g = graph.current;
      if (!g) return;
      const key = visibleNodes.map((n) => n.id).join('\0') + '|' + props.edges.length;
      if (key === shownKey.current) {
        updateVisuals();
        return;
      }
      const requestId = ++layoutRequest.current;
      const ids = new Set(visibleNodes.map((n) => n.id));
      const links = props.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      const apply = (positions: Map<string, [number, number, number]> | null) => {
        if (requestId !== layoutRequest.current || !graph.current) return;
        const nodes = visibleNodes.map((node) => {
          const existing = sceneNodes.current.get(node.id);
          const scene = existing ? Object.assign(existing, node) : ({ ...node } as SceneNode);
          const p = positions?.get(node.id) || positionCache.get(node.id);
          if (p) {
            scene.x = p[0];
            scene.y = p[1];
            scene.z = p[2];
            scene.fx = p[0];
            scene.fy = p[1];
            scene.fz = p[2];
            remember(node.id, p);
          }
          return scene;
        });
        for (const id of [...sceneNodes.current.keys()])
          if (!ids.has(id)) {
            sceneNodes.current.delete(id);
            visuals.current.delete(id);
          }
        for (const n of nodes) sceneNodes.current.set(n.id, n);
        plannedNodes.current = nodes.length;
        // Arrows cost one material and one geometry each in 3d-force-graph; they are drawn only for small views.
        g.linkDirectionalArrowLength(
          links.length > 150
            ? 0
            : (e: SceneEdge) => (e.verified && e.type !== 'aggregate' ? 2.3 : 0),
        );
        if (!positions) g.cooldownTicks(120);
        else g.cooldownTicks(2);
        engineRunning.current = true;
        g.graphData({
          nodes,
          links: links.map((e) => ({ ...e, sourceId: e.source, targetId: e.target })),
        });
        shownKey.current = key;
        updateVisuals();
        const mode = latest.current.viewKey;
        if (!fitted.current || (savedCamera?.viewKey !== mode && shownMode.current !== mode)) {
          fitted.current = true;
          fit(shownMode.current ? duration() : 0);
        }
        shownMode.current = mode;
        wake(1500);
      };
      const w = worker.current;
      if (!w) {
        apply(null);
        return;
      }
      const request: LayoutRequest = {
        requestId,
        ticks: 160,
        nodes: visibleNodes.map((n) => {
          const p = positionCache.get(n.id);
          return p
            ? {
                id: n.id,
                x: p[0],
                y: p[1],
                z: p[2],
                fixed: true,
                mass: n.type === 'community' ? Math.max(1, Math.log2(n.count || 1)) : 1,
              }
            : { id: n.id, mass: n.type === 'community' ? Math.max(1, Math.log2(n.count || 1)) : 1 };
        }),
        links: links.map((l) => ({
          source: l.source,
          target: l.target,
          distance: l.type === 'aggregate' ? 110 : 48,
        })),
      };
      const onMessage = (event: MessageEvent<LayoutResult>) => {
        if (event.data.requestId !== requestId) return;
        w.removeEventListener('message', onMessage);
        setLayoutMs(Math.round(event.data.ms));
        apply(new Map(event.data.positions.map(([id, x, y, z]) => [id, [x, y, z]])));
      };
      const onError = () => {
        w.removeEventListener('message', onMessage);
        apply(null);
      };
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError, { once: true });
      w.postMessage(request);
      return () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      };
    }, [props.nodes, props.edges]);
    useEffect(() => {
      updateVisuals();
      if (graph.current) {
        (graph.current.controls() as OrbitControls).autoRotate = rotating;
        if (rotating) wake(600);
      }
    }, [props.highlights, props.selectedId, hovered, labels, rotating]);
    useEffect(() => {
      const g = graph.current;
      if (!g) return;
      if (props.active) wake(800);
      else {
        animationRunning.current = false;
        g.pauseAnimation();
      }
    }, [props.active]);
    // Highlighted particles are chosen when links are digested; re-digest only when the highlight set changes.
    useEffect(() => {
      const g = graph.current;
      if (!g) return;
      const active = new Set(props.highlights);
      g.linkDirectionalParticles((e: SceneEdge) =>
        !reducedMotion.current && e.verified && active.has(e.sourceId) && active.has(e.targetId)
          ? 2
          : 0,
      );
      updateLinks();
      wake(1200);
    }, [props.highlights]);

    function keyboard(event: React.KeyboardEvent<HTMLDivElement>) {
      if (event.target !== event.currentTarget || !graph.current) return;
      const g = graph.current;
      const target = (g.controls() as OrbitControls).target;
      const relative = g.camera().position.clone().sub(target);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        relative.applyAxisAngle(
          new Vector3(horizontal ? 0 : 1, horizontal ? 1 : 0, 0),
          event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 0.16 : -0.16,
        );
        g.cameraPosition(relative.add(target), target, 0);
        wake(400);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(0.8);
      } else if (event.key === '-') {
        event.preventDefault();
        zoom(1.25);
      } else if (event.key === 'Home') {
        event.preventDefault();
        fit();
      }
    }
    return (
      <div
        className="spatial-graph"
        data-mode="3d"
        data-node-count={visibleNodes.length}
        data-layout-ms={layoutMs ?? ''}
      >
        <div className="spatial-hud">
          <span className="spatial-badge">
            <i /> מרחב ידע תלת־ממדי
          </span>
          <div className="spatial-options">
            <button
              aria-pressed={rotating}
              disabled={!!failure}
              onClick={() => setRotating((v) => !v)}
            >
              {rotating ? 'Ⅱ עצירת סיבוב' : '↻ סיבוב אוטומטי'}
            </button>
            <button aria-pressed={labels} disabled={!!failure} onClick={() => setLabels((v) => !v)}>
              Aa שמות
            </button>
          </div>
        </div>
        <div
          ref={host}
          className="spatial-canvas"
          tabIndex={0}
          role="region"
          aria-label="גרף ידע תלת־ממדי אינטראקטיבי"
          aria-describedby="graph-3d-help"
          onKeyDown={keyboard}
        />
        {failure ? (
          <div className="graph-fallback" role="alert">
            <span>◈</span>
            <p>{failure}</p>
            <button onClick={props.onFallback}>מעבר לתצוגת 2D</button>
          </div>
        ) : (
          !visibleNodes.length && (
            <div className="graph-empty" role="status">
              {props.viewKey === 'idle'
                ? 'בחרו מסמך בספרייה או חפשו במפה כדי להציג את הקשרים שלו.'
                : 'לא נמצאו צמתים התואמים לחיפוש או לסינון.'}
            </div>
          )
        )}
        <div className="spatial-bottom">
          <span id="graph-3d-help">גרירת רקע לסיבוב · גלילה להגדלה · גרירה ימנית להזזה</span>
          <details className="graph-node-menu">
            <summary>
              רשימת צמתים <b>{visibleNodes.length}</b>
            </summary>
            <div>
              {visibleNodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    props.onSelectNode(node);
                    const positioned = sceneNodes.current.get(node.id);
                    if (positioned && node.type !== 'community') focusNode(positioned);
                  }}
                >
                  <i style={{ background: props.types[node.type]?.color }} />
                  <span>
                    {node.label}
                    <small>{node.type === 'community' ? 'קבוצת מסמכים' : node.id}</small>
                  </span>
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    );
  }),
);
export default KnowledgeGraph3D;

/// <reference lib="webworker" />
// Force layout runs here, off the main thread. Previously 3d-force-graph ran 150 synchronous warm-up ticks
// on the main thread for every data change (part of the measured 200–740 ms long tasks).
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type SimNode,
} from 'd3-force-3d';
export type LayoutRequest = {
  requestId: number;
  nodes: { id: string; x?: number; y?: number; z?: number; fixed?: boolean; mass?: number }[];
  links: { source: string; target: string; distance?: number }[];
  ticks: number;
};
export type LayoutResult = {
  requestId: number;
  positions: [string, number, number, number][];
  ms: number;
};
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const start = performance.now();
  const { requestId, nodes, links, ticks } = event.data;
  const known = new Set(nodes.map((n) => n.id));
  // Already-placed nodes stay fixed so expanding a community does not rearrange what the user is looking at.
  const simNodes: SimNode[] = nodes.map((n, i) => {
    const angle = i * 2.399963,
      y = 1 - (2 * (i + 0.5)) / Math.max(1, nodes.length),
      r = 70 * Math.sqrt(1 - y * y);
    const x = n.x ?? r * Math.cos(angle),
      yy = n.y ?? 70 * y * 0.8,
      z = n.z ?? r * Math.sin(angle);
    return n.fixed ? { id: n.id, x, y: yy, z, fx: x, fy: yy, fz: z } : { id: n.id, x, y: yy, z };
  });
  const simLinks = links
    .filter((l) => known.has(l.source) && known.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target, distance: l.distance }));
  const mass = new Map(nodes.map((n) => [n.id, n.mass || 1]));
  // Weak positional gravity keeps disconnected components (e.g. a community without links) from drifting away.
  const simulation = forceSimulation(simNodes, 3)
    .velocityDecay(0.36)
    .force(
      'charge',
      forceManyBody().strength((node: SimNode) => -150 * Math.sqrt(mass.get(node.id) || 1)),
    )
    .force(
      'link',
      forceLink(simLinks)
        .id((n) => n.id)
        .distance((l: { distance?: number }) => l.distance || 48),
    )
    .force('center', forceCenter())
    .force('x', forceX(0).strength(0.06))
    .force('y', forceY(0).strength(0.06))
    .force('z', forceZ(0).strength(0.06))
    .stop();
  if (simNodes.some((n) => n.fx === undefined)) simulation.tick(ticks);
  const positions = simNodes.map(
    (n) => [n.id, n.x || 0, n.y || 0, n.z || 0] as [string, number, number, number],
  );
  (self as unknown as Worker).postMessage({
    requestId,
    positions,
    ms: performance.now() - start,
  } satisfies LayoutResult);
};

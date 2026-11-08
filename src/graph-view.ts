export const GRAPH_VIEW_LIMIT = 250;
type Node = { id: string; label: string; type: string };
type Edge = { source: string; target: string };
export function graphView<N extends Node, E extends Edge>(
  nodes: readonly N[],
  edges: readonly E[],
  filter: string,
  search: string,
  highlights: readonly string[],
  selectedId?: string,
) {
  const query = search.trim().toLowerCase();
  const matching = nodes.filter(
    (n) =>
      (filter === 'all' || n.type === filter) &&
      (!query || `${n.label} ${n.id}`.toLowerCase().includes(query)),
  );
  if (matching.length <= GRAPH_VIEW_LIMIT) return { nodes: matching, matching: matching.length };
  const sources = new Set(highlights);
  const neighbors = new Set<string>();
  if (selectedId)
    for (const edge of edges)
      if (edge.source === selectedId || edge.target === selectedId) {
        neighbors.add(edge.source);
        neighbors.add(edge.target);
      }
  const rank = (node: N) =>
    node.id === selectedId
      ? 0
      : sources.has(node.id)
        ? 1
        : neighbors.has(node.id)
          ? 2
          : node.type !== 'document'
            ? 3
            : 4;
  const ranked = [...matching].sort((a, b) => rank(a) - rank(b));
  return { nodes: ranked.slice(0, GRAPH_VIEW_LIMIT), matching: matching.length };
}

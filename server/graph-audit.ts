export function graphStatistics(
  nodes: { id: string; type: string }[],
  edges: { source: string; target: string }[],
) {
  const adjacency = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  let danglingEdges = 0;
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) {
      danglingEdges++;
      continue;
    }
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  const seen = new Set<string>(),
    components: number[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    seen.add(node.id);
    let size = 0;
    while (stack.length) {
      const id = stack.pop()!;
      size++;
      for (const neighbor of adjacency.get(id) || [])
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
    }
    components.push(size);
  }
  const isolated = nodes.filter((n) => !adjacency.get(n.id)?.size);
  const distribution: Record<string, number> = {};
  for (const neighbors of adjacency.values()) {
    const k = String(neighbors.size);
    distribution[k] = (distribution[k] || 0) + 1;
  }
  return {
    nodes: nodes.length,
    edges: edges.length,
    danglingEdges,
    isolatedNodes: isolated.length,
    isolatedPercent: nodes.length ? (isolated.length / nodes.length) * 100 : 0,
    isolatedIds: isolated.map((n) => n.id),
    connectedComponents: components.length,
    largestComponent: Math.max(0, ...components),
    componentSizes: components.sort((a, b) => b - a),
    degreeDistribution: distribution,
  };
}

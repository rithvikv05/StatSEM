type DiagramNode = { id: string; parentId?: string; isLatent?: boolean; indicatorsHidden?: boolean };

/** Toggle a construct's display without changing its indicators or connections. */
export function toggleIndicatorVisibility(nodes: DiagramNode[], constructId: string, selection?: Set<string>): boolean {
  const construct = nodes.find(node => node.id === constructId && node.isLatent !== false);
  const indicators = nodes.filter(node => node.parentId === constructId && !node.isLatent);
  if (!construct || indicators.length === 0) return false;
  construct.indicatorsHidden = !construct.indicatorsHidden;
  if (construct.indicatorsHidden) indicators.forEach(indicator => {
    selection?.delete(indicator.id);
    selection?.delete(`edge_ind_${indicator.id}`);
  });
  return true;
}

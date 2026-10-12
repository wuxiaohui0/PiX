/** Tree visibility is independent of viewport culling and never removes session data. */
export function graphVisibility(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
  collapsed: ReadonlySet<string>,
  retained?: ReadonlySet<string>,
) {
  const children = new Map<string | null, string[]>();
  const ids = new Set(nodes.map(node => node.id));
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(node.id);
    children.set(parent, siblings);
  }
  const hidden = new Set<string>();
  const hiddenCounts = new Map<string, number>();
  const stack = (children.get(null) ?? []).map(id => ({ id, owner: retained && !retained.has(id) ? id : undefined as string | undefined }));
  while (stack.length) {
    const { id, owner } = stack.pop()!;
    if (owner) {
      hidden.add(id);
      hiddenCounts.set(owner, (hiddenCounts.get(owner) ?? 0) + 1);
    }
    for (const child of children.get(id) ?? []) {
      stack.push({ id: child, owner: owner ?? (collapsed.has(id) || (retained && !retained.has(child)) ? id : undefined) });
    }
  }
  return { hidden, hiddenCounts, parentsWithChildren: new Set(children.keys()) };
}

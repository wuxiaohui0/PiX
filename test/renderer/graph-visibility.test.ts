import { describe, expect, it } from "vitest";
import { graphVisibility } from "../../src/renderer/lib/graph-visibility";

const nodes = [
  { id: "root", parentId: null },
  { id: "active", parentId: "root" },
  { id: "other", parentId: "root" },
  { id: "leaf", parentId: "other" },
];

describe("graph branch visibility", () => {
  it("hides descendants, retaining their anchor and counting nested folds once", () => {
    const result = graphVisibility(nodes, new Set(["root", "other"]));
    expect([...result.hidden].sort()).toEqual(["active", "leaf", "other"]);
    expect([...result.hiddenCounts]).toEqual([["root", 3]]);
    expect(nodes).toHaveLength(4);
  });

  it("hides inactive siblings at the shared ancestor", () => {
    const result = graphVisibility(nodes, new Set(), new Set(["root", "active"]));
    expect([...result.hidden].sort()).toEqual(["leaf", "other"]);
    expect(result.hiddenCounts.get("root")).toBe(2);
  });

  it("handles deep histories without recursive traversal", () => {
    const deep = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), parentId: i ? String(i - 1) : null }));
    const result = graphVisibility(deep, new Set(["0"]));
    expect(result.hidden.size).toBe(19999);
    expect(result.hiddenCounts.get("0")).toBe(19999);
  });

  it("restores every node when filters are cleared, including orphan roots", () => {
    const result = graphVisibility([...nodes, { id: "orphan", parentId: "missing" }], new Set());
    expect(result.hidden.size).toBe(0);
  });
});

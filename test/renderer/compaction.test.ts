import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { branchContext, compactionProgress } from "../../src/shared/compaction";
import { projectSession } from "../../src/shared/session";
import type { RawSessionEntry, SessionSnapshot } from "../../src/shared/types";
import { createBranchMessageCache } from "../../src/renderer/lib/session-view";
import { useSessionStore } from "../../src/renderer/stores/session";
import CompactionHistory from "../../src/renderer/features/branch-context/CompactionHistory.vue";
import { i18n } from "../../src/renderer/i18n";

const timestamp = "2026-10-12T00:00:00Z";
const message = (id: string, parentId: string | null, role = "user"): RawSessionEntry => ({ id, parentId, timestamp, type: "message", message: { role, content: id } });
const entries: RawSessionEntry[] = [message("u1", null), message("a1", "u1", "assistant"), message("u2", "a1"), message("a2", "u2", "assistant"),
  { id: "c1", parentId: "a2", timestamp, type: "compaction", summary: "Preserve the design decision", firstKeptEntryId: "u2", tokensBefore: 80000 },
  message("u3", "c1"), message("a3", "u3", "assistant")];

describe("compaction transparency", () => {
  it("records boundaries and retains summaries when recent history is paged", () => {
    const window = createBranchMessageCache()(entries, "a3", 1);
    expect(window.messages.map(message => message.entryId)).toEqual(["u3", "a3"]);
    expect(window.compactions[0]).toMatchObject({ summarizedMessages: 2, retainedMessages: 2, firstKeptEntryId: "u2", tokensBefore: 80000, active: true });
    const projection = projectSession(entries, "a3");
    expect(projection.messages.find(message => message.entryId === "c1")).toMatchObject({ compaction: true });
    expect(projection.messages.find(message => message.entryId === "u1")).toMatchObject({ contextStatus: "excluded", contextReason: "compaction", text: "u1" });
    expect(projection.nodes.find(node => node.id === "turn:u2")?.compactionCount).toBe(1);
  });

  it("applies context edits outside the display page without parsing earlier text", () => {
    const data = [...entries, { id: "edit", parentId: "a3", timestamp, type: "context_edit", targetId: "u3", replacement: { content: "different input" } }, message("u4", "edit")];
    const history = createBranchMessageCache()(data, "u4", 2);
    expect(history.messages.find(message => message.entryId === "u3")).toMatchObject({ text: "u3", contextStatus: "modified", contextReason: "edit" });
  });

  it("matches summary-only and repeated compaction boundaries", () => {
    const newer = { id: "c2", parentId: "a3", timestamp, type: "compaction", summary: "new summary", firstKeptEntryId: "u2" };
    const context = branchContext([...entries, newer]);
    expect(context.statuses.get("c1")).toBe("excluded");
    expect(context.statuses.has("c2")).toBe(false);
    expect(context.compactions.map(item => item.active)).toEqual([false, true]);
    const invalid = branchContext([...entries, { ...newer, firstKeptEntryId: "sibling" }]);
    expect(invalid.statuses.get("a3")).toBe("excluded");
    expect(invalid.compactions.at(-1)?.retainedMessages).toBe(0);
  });

  it("distinguishes completion, cancellation and failure without inventing token counts", () => {
    expect(compactionProgress({ type: "compaction_start", reason: "threshold" })).toEqual({ status: "running", reason: "threshold" });
    expect(compactionProgress({ type: "compaction_end", aborted: true })?.status).toBe("cancelled");
    expect(compactionProgress({ type: "compaction_end", errorMessage: "network error" })).toMatchObject({ status: "error", error: "network error", estimatedTokensAfter: undefined });
    expect(compactionProgress({ type: "message_end" })).toBeUndefined();
  });

  it("isolates progress by branch and ignores stale or foreign run events", () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.applySnapshot({ session: { id: "s", path: "s" }, entries, projection: projectSession(entries, "a3"), runtime: { available: true },
      graph: { id: "s", epoch: "e", revision: 1, runs: [{ branchId: "A", runId: "r1", nodeId: "turn:u3", status: "running" }] } } as SessionSnapshot);
    const scope = { graphId: "s", branchId: "A", runId: "r1" };
    session.onAgentEvent({ ...scope, type: "compaction_start", reason: "overflow" });
    expect(session.compactionFor("turn:u3")).toMatchObject({ status: "running", reason: "overflow" });
    expect(session.compactionFor("turn:u1")).toBeUndefined();
    session.onAgentEvent({ ...scope, graphId: "other", type: "compaction_end", aborted: true });
    session.onAgentEvent({ ...scope, runId: "stale", type: "compaction_end", aborted: true });
    expect(session.compactionFor("turn:u3")?.status).toBe("running");
    session.onAgentEvent({ ...scope, type: "compaction_end", aborted: true });
    expect(session.compactionFor("turn:u3")?.status).toBe("cancelled");
    session.applySnapshot({ ...session.current!, session: { ...session.current!.session, path: "other" } });
    expect(session.compactions).toEqual({});
  });

  it("shows the saved summary lazily and labels post-compaction tokens as estimates", async () => {
    i18n.global.locale.value = "en";
    const MarkdownRenderer = defineComponent({ name: "MarkdownRenderer", props: ["content"], template: '<div class="summary-body">{{ content }}</div>' });
    const records = branchContext(entries).compactions;
    const progress = compactionProgress({ type: "compaction_end", reason: "manual", result: { summary: records[0]!.summary, estimatedTokensAfter: 12000 } });
    const wrapper = mount(CompactionHistory, { props: { records, progress, scope: "s", autoEnabled: true }, global: { plugins: [i18n], stubs: { MarkdownRenderer } } });
    try {
      expect(wrapper.text()).toContain("Context compacted");
      expect(wrapper.find('.summary-body').exists()).toBe(false);
      const details = wrapper.get('details'); (details.element as HTMLDetailsElement).open = true;
      await details.trigger("toggle"); await flushPromises();
      expect(wrapper.text()).toContain("80,000 tokens");
      expect(wrapper.text()).toContain("Estimated immediately after compaction: 12,000 tokens");
      expect(wrapper.text()).toContain(records[0]!.summary);
      await wrapper.setProps({ records: [], progress: undefined, scope: "other" });
      expect(wrapper.find('.compaction-history').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});

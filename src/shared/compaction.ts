import type { BranchMessage, RawSessionEntry } from "./types.js";

export interface CompactionRecord {
  entryId: string;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string | null;
  firstKeptTimestamp: string | null;
  tokensBefore: number | null;
  summarizedMessages: number;
  retainedMessages: number;
  active: boolean;
}

/** Read context boundaries without parsing historical message bodies. */
export function branchContext(path: readonly RawSessionEntry[]) {
  const positions = new Map(path.map((entry, i) => [entry.id, i]));
  const messageCounts = [0];
  for (const entry of path) messageCounts.push(messageCounts.at(-1)! + (entry.type === "message" ? 1 : 0));
  const compactions: CompactionRecord[] = [];
  let latest = -1, keptFrom = 0;
  for (let i = 0; i < path.length; i++) {
    const entry = path[i]!;
    if (entry.type !== "compaction") continue;
    latest = i;
    // Missing or off-path boundaries mean summary-only context in Pi.
    const boundary = typeof entry.firstKeptEntryId === "string" ? positions.get(entry.firstKeptEntryId) : undefined;
    keptFrom = boundary !== undefined && boundary < i ? boundary : i;
    compactions.push({
      entryId: entry.id, timestamp: entry.timestamp,
      summary: typeof entry.summary === "string" ? entry.summary : "",
      firstKeptEntryId: keptFrom < i ? path[keptFrom]!.id : null,
      firstKeptTimestamp: keptFrom < i ? path[keptFrom]!.timestamp : null,
      tokensBefore: typeof entry.tokensBefore === "number" && Number.isFinite(entry.tokensBefore) && entry.tokensBefore >= 0 ? entry.tokensBefore : null,
      summarizedMessages: messageCounts[Math.min(keptFrom, i)]!,
      retainedMessages: messageCounts[i]! - messageCounts[Math.min(keptFrom, i)]!,
      active: false,
    });
  }
  if (compactions.length) compactions.at(-1)!.active = true;
  const statuses = new Map<string, NonNullable<BranchMessage["contextStatus"]>>();
  const reasons = new Map<string, "compaction" | "edit">();
  for (let i = 0; i < path.length; i++) {
    const entry = path[i]!;
    if ((i < keptFrom && i !== latest) || (entry.type === "compaction" && i !== latest)) {
      statuses.set(entry.id, "excluded"); reasons.set(entry.id, "compaction");
    }
  }
  for (const entry of path.slice(keptFrom)) {
    if (entry.type !== "context_edit" || typeof entry.targetId !== "string") continue;
    const target = positions.get(entry.targetId);
    if (target === undefined || (target < keptFrom && target !== latest) || statuses.get(entry.targetId) === "excluded" && reasons.get(entry.targetId) === "compaction") continue;
    statuses.set(entry.targetId, entry.replacement === null ? "excluded" : "modified");
    reasons.set(entry.targetId, "edit");
  }
  return { compactions, statuses, reasons };
}

export interface CompactionProgress {
  status: "running" | "complete" | "cancelled" | "error";
  reason?: "manual" | "threshold" | "overflow";
  error?: string;
  summary?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  willRetry?: boolean;
}

export function compactionProgress(event: unknown): CompactionProgress | undefined {
  if (!event || typeof event !== "object") return;
  const value = event as Record<string, unknown>;
  if (value.type !== "compaction_start" && value.type !== "compaction_end") return;
  const reason = ["manual", "threshold", "overflow"].includes(String(value.reason)) ? value.reason as CompactionProgress["reason"] : undefined;
  if (value.type === "compaction_start") return { status: "running", reason };
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : undefined;
  const number = (key: string) => typeof result?.[key] === "number" && Number.isFinite(result[key]) && result[key] >= 0 ? result[key] as number : undefined;
  return {
    status: value.aborted ? "cancelled" : result ? "complete" : "error", reason,
    error: typeof value.errorMessage === "string" ? value.errorMessage : undefined,
    summary: typeof result?.summary === "string" ? result.summary : undefined,
    tokensBefore: number("tokensBefore"), estimatedTokensAfter: number("estimatedTokensAfter"),
    willRetry: value.willRetry === true,
  };
}

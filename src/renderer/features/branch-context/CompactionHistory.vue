<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Archive, LoaderCircle } from "@lucide/vue";
import type { CompactionProgress, CompactionRecord } from "../../../shared/compaction";
import MarkdownRenderer from "../../components/MarkdownRenderer.vue";
import CopyButton from "../../components/CopyButton.vue";

const props = defineProps<{ records: CompactionRecord[]; progress?: CompactionProgress; scope: string; autoEnabled?: boolean }>();
const { t, locale } = useI18n();
const expanded = ref(new Set<string>());
watch(() => props.scope, () => { expanded.value = new Set(); });
const latest = computed(() => props.records.at(-1));
const completed = computed(() => props.progress?.status === "complete" && props.progress.summary === latest.value?.summary ? props.progress : undefined);
const numbers = (value: number) => new Intl.NumberFormat(locale.value).format(value);
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale.value);
}
function toggle(id: string, event: Event) {
  const next = new Set(expanded.value);
  if ((event.currentTarget as HTMLDetailsElement).open) next.add(id); else next.delete(id);
  expanded.value = next;
}
</script>

<template>
  <section v-if="records.length || progress" class="compaction-history" :aria-label="t('branch.compactionHistory')">
    <div v-if="progress" class="compaction-progress" role="status" aria-live="polite" :data-compaction-status="progress.status">
      <LoaderCircle v-if="progress.status === 'running'" :size="14" class="spin" />
      <strong>{{ t(`branch.compactionStatus.${progress.status}`) }}</strong>
      <span v-if="progress.reason">{{ t(`branch.compactionReason.${progress.reason}`) }}</span>
      <small v-if="progress.error">{{ progress.error }}</small>
      <small v-if="progress.willRetry">{{ t('branch.compactionRetry') }}</small>
    </div>
    <p class="compaction-explanation">{{ t('branch.compactionExplanation') }}</p>
    <small v-if="autoEnabled !== undefined">{{ t(autoEnabled ? 'branch.autoCompactionOn' : 'branch.autoCompactionOff') }}</small>
    <details v-for="record in [...records].reverse()" :key="record.entryId" class="compaction-record"
      :data-compaction-id="record.entryId" :open="expanded.has(record.entryId)" @toggle="toggle(record.entryId, $event)">
      <summary>
        <Archive :size="14" aria-hidden="true" />
        <strong>{{ t(record.active ? 'branch.compactionActive' : 'branch.compactionPast') }}</strong>
        <time :datetime="record.timestamp">{{ date(record.timestamp) }}</time>
      </summary>
      <div v-if="expanded.has(record.entryId)" class="compaction-details">
        <p>{{ t('branch.compactionMessages', { summarized: record.summarizedMessages, retained: record.retainedMessages }) }}</p>
        <p v-if="record.tokensBefore !== null">{{ t('branch.compactionTokensBefore', { n: numbers(record.tokensBefore) }) }}</p>
        <p v-if="record.active && completed?.estimatedTokensAfter !== undefined">{{ t('branch.compactionTokensAfter', { n: numbers(completed.estimatedTokensAfter) }) }}</p>
        <p>{{ t(record.firstKeptTimestamp ? 'branch.compactionBoundary' : 'branch.compactionSummaryOnly', { time: record.firstKeptTimestamp ? date(record.firstKeptTimestamp) : '' }) }}</p>
        <MarkdownRenderer v-if="record.summary" :content="record.summary" :custom-id="`${scope}:compaction:${record.entryId}`" />
        <p v-else>{{ t('branch.compactionNoSummary') }}</p>
        <CopyButton v-if="record.summary" :text="record.summary" />
      </div>
    </details>
  </section>
</template>

<style scoped>
.compaction-history { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-subtle); color: var(--muted); font-size: var(--font-size-small); }
.compaction-progress, .compaction-record summary { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.compaction-progress small { flex-basis: 100%; overflow-wrap: anywhere; }
.compaction-progress[data-compaction-status="error"] { color: var(--danger); }
.compaction-explanation { margin: 6px 0; }
.compaction-record { margin-top: 8px; }
.compaction-record summary { cursor: pointer; }
.compaction-record time { font-size: var(--font-size-caption); }
.compaction-details { margin-top: 8px; overflow-wrap: anywhere; }
.compaction-details p { margin: 6px 0; }
</style>

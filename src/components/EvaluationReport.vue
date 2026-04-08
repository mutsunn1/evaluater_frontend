<script setup lang="ts">
import type { EvaluationCompleteEvent } from '../types/evaluation'

defineProps<{
  report: EvaluationCompleteEvent | null
}>()
</script>

<template>
  <article class="w-full max-w-3xl space-y-4 rounded-2xl border border-zinc-700/70 bg-zinc-900/70 p-6">
    <p class="text-xs uppercase tracking-[0.24em] text-emerald-300">Evaluation Complete</p>
    <h2 class="text-2xl font-semibold">{{ report?.report_title || '评测完成' }}</h2>
    <p class="text-zinc-300">{{ report?.report_summary || '已收到最终报告，请查看详细结果。' }}</p>
    <pre class="max-h-72 overflow-auto rounded-xl bg-zinc-950/80 p-4 text-xs text-zinc-300">{{ JSON.stringify(report?.report ?? {}, null, 2) }}</pre>
  </article>
</template>

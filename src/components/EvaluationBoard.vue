<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  heartbeat,
  pauseTimer,
  resumeTimer,
  startEvaluation,
  submitAnswer,
} from '../api/evaluation'
import EvaluationReport from './EvaluationReport.vue'
import { useEvaluationStream } from '../composables/useEvaluationStream'
import { useServerTimer } from '../composables/useServerTimer'
import { useVisibilityTracker } from '../composables/useVisibilityTracker'
import type { EvaluationQuestion } from '../types/evaluation'

type Phase = 'idle' | 'starting' | 'active' | 'analyzing' | 'complete' | 'error'

const phase = ref<Phase>('idle')
const sessionId = ref('')
const answerText = ref('')
const typedStem = ref('')
const currentQuestion = ref<EvaluationQuestion | null>(null)
const isNetworkPaused = ref(false)
const consecutiveHeartbeatFailures = ref(0)
const networkMessage = ref('')
const errorMessage = ref('')

let heartbeatTimer: number | null = null
let typingTimer: number | null = null

const stream = useEvaluationStream({
  onNewQuestion(payload) {
    timer.startCountdown({
      serverTimestampMs: payload.server_timestamp_ms,
      hardTimeoutMs: payload.question.hard_timeout_ms,
      expectedTimeMs: payload.question.expected_time_ms,
    })
    phase.value = 'active'
    answerText.value = ''
    currentQuestion.value = payload.question
    runTypewriter(payload.question.stem)
  },
  onEvaluationComplete() {
    phase.value = 'complete'
    timer.pauseLocal()
    stopHeartbeat()
  },
})

const timer = useServerTimer({
  onTimeout: async () => {
    if (!sessionId.value || !currentQuestion.value) return
    await safeSubmit(true)
  },
})

const canTrackVisibility = computed(
  () => Boolean(sessionId.value) && (phase.value === 'active' || phase.value === 'analyzing'),
)

useVisibilityTracker({
  enabled: canTrackVisibility,
  onHidden: async () => {
    if (!sessionId.value || isNetworkPaused.value) return
    await pauseTimer(sessionId.value, 'tab_switch')
    timer.pauseLocal()
  },
  onVisible: async () => {
    if (!sessionId.value || isNetworkPaused.value) return
    await resumeTimer(sessionId.value)
    timer.resumeLocal()
  },
})

watch(
  () => stream.currentQuestion.value,
  (next) => {
    if (!next) return
    currentQuestion.value = next
  },
)

const progressClass = computed(() => {
  if (timer.isOverExpected.value) return 'from-amber-500 to-orange-500'
  return 'from-emerald-500 to-lime-500'
})

const timerLabel = computed(() => {
  const total = timer.displaySeconds.value
  const minute = Math.floor(total / 60)
  const second = total % 60
  return `${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
})

const isBusy = computed(() => phase.value === 'starting' || phase.value === 'analyzing')
const progressDisplay = computed(() => timer.progressPercent.value.toFixed(1))
const reportData = computed(() => stream.report.value)
const connectionStateText = computed(() => stream.connectionState.value)

async function beginEvaluation() {
  try {
    phase.value = 'starting'
    errorMessage.value = ''
    networkMessage.value = ''

    const data = await startEvaluation()
    sessionId.value = data.session_id

    timer.startCountdown({
      serverTimestampMs: data.server_timestamp_ms,
      hardTimeoutMs: data.first_question.hard_timeout_ms,
      expectedTimeMs: data.first_question.expected_time_ms,
    })

    currentQuestion.value = data.first_question
    runTypewriter(data.first_question.stem)

    stream.connect(data.session_id)
    startHeartbeat()
    phase.value = 'active'
  } catch (error) {
    phase.value = 'error'
    errorMessage.value = (error as Error).message
  }
}

async function safeSubmit(byTimeout = false) {
  if (!sessionId.value || !currentQuestion.value) return

  try {
    phase.value = 'analyzing'
    stream.markAnalyzing(true)
    timer.pauseLocal()

    await submitAnswer(sessionId.value, currentQuestion.value.q_id, {
      answer: byTimeout ? '[AUTO_SUBMIT_TIMEOUT]' : answerText.value,
    })
  } catch (error) {
    phase.value = 'error'
    errorMessage.value = (error as Error).message
    stream.markAnalyzing(false)
  }
}

function runTypewriter(text: string) {
  if (typingTimer !== null) {
    window.clearInterval(typingTimer)
  }

  typedStem.value = ''
  let index = 0
  typingTimer = window.setInterval(() => {
    index += 1
    typedStem.value = text.slice(0, index)

    if (index >= text.length && typingTimer !== null) {
      window.clearInterval(typingTimer)
      typingTimer = null
    }
  }, 20)
}

function startHeartbeat() {
  stopHeartbeat()

  heartbeatTimer = window.setInterval(async () => {
    if (!sessionId.value || phase.value === 'complete') return

    try {
      await heartbeat(sessionId.value)
      consecutiveHeartbeatFailures.value = 0
      networkMessage.value = ''
      if (isNetworkPaused.value) {
        isNetworkPaused.value = false
        timer.resumeLocal()
      }
    } catch {
      consecutiveHeartbeatFailures.value += 1
      if (consecutiveHeartbeatFailures.value >= 3) {
        isNetworkPaused.value = true
        timer.pauseLocal()
        networkMessage.value = '网络异常：心跳连续失败，已暂停本地计时。请检查网络后重试。'
      }
    }
  }, 5000)
}

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

async function retryFromNetworkPause() {
  if (!sessionId.value) return

  try {
    await resumeTimer(sessionId.value)
    await heartbeat(sessionId.value)
    consecutiveHeartbeatFailures.value = 0
    isNetworkPaused.value = false
    networkMessage.value = ''
    timer.resumeLocal()
  } catch {
    networkMessage.value = '恢复失败，请稍后重试。'
  }
}

onBeforeUnmount(() => {
  stopHeartbeat()
  stream.disconnect()

  if (typingTimer !== null) {
    window.clearInterval(typingTimer)
  }
})
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.18),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.22),transparent_45%),linear-gradient(120deg,#0b0f14_0%,#141a22_55%,#0b0f14_100%)]" />

    <main class="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-8">
      <header class="mb-6 flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-4 backdrop-blur">
        <div>
          <p class="font-mono text-xs tracking-[0.24em] text-emerald-300/90">HSK EVALUATION</p>
          <h1 class="mt-1 text-2xl font-semibold sm:text-3xl">动态交互式中文评测</h1>
        </div>
        <div class="text-right">
          <p class="font-mono text-xs text-zinc-400">SESSION</p>
          <p class="max-w-36 truncate font-mono text-sm text-zinc-200">{{ sessionId || '未开始' }}</p>
        </div>
      </header>

      <section
        v-if="phase === 'starting'"
        class="grid flex-1 animate-pulse place-items-center rounded-3xl border border-zinc-800/70 bg-zinc-900/40 p-6"
      >
        <div class="w-full max-w-3xl space-y-4">
          <div class="h-4 w-1/3 rounded bg-zinc-700/70" />
          <div class="h-8 w-2/3 rounded bg-zinc-800/80" />
          <div class="h-28 rounded-2xl bg-zinc-800/70" />
          <div class="h-28 rounded-2xl bg-zinc-800/60" />
        </div>
      </section>

      <section
        v-else-if="phase === 'idle'"
        class="grid flex-1 place-items-center rounded-3xl border border-zinc-800/70 bg-zinc-900/45 p-6"
      >
        <div class="max-w-xl space-y-6 text-center">
          <p class="text-sm uppercase tracking-[0.22em] text-zinc-400">Ready</p>
          <h2 class="text-3xl font-semibold leading-tight sm:text-4xl">
            服务端权威计时 + SSE 流式推送
          </h2>
          <p class="text-zinc-300/85">
            开始后将自动建立长连接、启动心跳保活，并启用切屏监听。
          </p>
          <button
            class="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            @click="beginEvaluation"
          >
            开始评测
          </button>
        </div>
      </section>

      <section
        v-else-if="phase === 'complete'"
        class="grid flex-1 place-items-center rounded-3xl border border-emerald-500/25 bg-zinc-900/50 p-6"
      >
        <EvaluationReport :report="reportData" />
      </section>

      <section
        v-else-if="phase === 'error'"
        class="grid flex-1 place-items-center rounded-3xl border border-rose-500/30 bg-zinc-900/45 p-6"
      >
        <div class="max-w-2xl space-y-4 text-center">
          <p class="text-sm uppercase tracking-[0.2em] text-rose-300">Error</p>
          <p class="text-lg text-zinc-200">{{ errorMessage || '发生未知异常，请稍后重试。' }}</p>
          <button
            class="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-100 transition hover:bg-zinc-800"
            @click="beginEvaluation"
          >
            重新开始
          </button>
        </div>
      </section>

      <section
        v-else
        class="relative flex flex-1 flex-col gap-4 rounded-3xl border border-zinc-800/80 bg-zinc-900/45 p-4 backdrop-blur sm:p-6"
      >
        <div class="rounded-xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <div class="mb-2 flex items-center justify-between text-xs text-zinc-300">
            <span>剩余时间 {{ timerLabel }}</span>
            <span class="font-mono">{{ progressDisplay }}%</span>
          </div>
          <div class="h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              class="h-full rounded-full bg-gradient-to-r transition-all duration-300"
              :class="progressClass"
              :style="{ width: `${timer.progressPercent}%` }"
            />
          </div>
          <p v-if="timer.isOverExpected" class="mt-2 text-xs text-amber-300">
            已超过建议作答时长，进入警戒阶段。
          </p>
        </div>

        <div
          v-if="networkMessage"
          class="flex items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          <p>{{ networkMessage }}</p>
          <button
            class="shrink-0 rounded-lg border border-amber-300/40 px-3 py-1 text-xs hover:bg-amber-400/10"
            @click="retryFromNetworkPause"
          >
            重试恢复
          </button>
        </div>

        <article class="flex-1 rounded-2xl border border-zinc-800/80 bg-zinc-950/65 p-5">
          <p class="mb-3 text-xs uppercase tracking-[0.2em] text-emerald-300/90">
            Question {{ currentQuestion?.q_id || '--' }}
          </p>
          <p class="min-h-20 text-lg leading-relaxed sm:text-xl">{{ typedStem }}</p>

          <ul
            v-if="currentQuestion?.options?.length"
            class="mt-5 grid gap-3 sm:grid-cols-2"
          >
            <li
              v-for="opt in currentQuestion.options"
              :key="opt.id"
              class="rounded-lg border border-zinc-700/70 bg-zinc-900/70 px-3 py-2 text-sm"
            >
              {{ opt.id }}. {{ opt.text }}
            </li>
          </ul>
        </article>

        <div class="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-4">
          <label class="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-400">你的作答</label>
          <textarea
            v-model="answerText"
            class="min-h-32 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900/85 p-3 text-zinc-100 outline-none transition focus:border-emerald-400"
            :disabled="isBusy || isNetworkPaused"
            placeholder="请输入你的答案..."
          />

          <div class="mt-4 flex items-center justify-between gap-3">
            <p class="text-xs text-zinc-400">连接状态：{{ connectionStateText }}</p>
            <button
              class="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300"
              :disabled="isBusy || !currentQuestion || isNetworkPaused"
              @click="safeSubmit(false)"
            >
              提交答案
            </button>
          </div>
        </div>

        <transition name="fade-slide">
          <div
            v-if="phase === 'analyzing'"
            class="absolute inset-0 grid place-items-center rounded-3xl bg-zinc-950/85 backdrop-blur"
          >
            <div class="space-y-4 text-center">
              <div class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-400" />
              <p class="text-sm uppercase tracking-[0.24em] text-zinc-300">Agent 分析中...</p>
            </div>
          </div>
        </transition>
      </section>
    </main>
  </div>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  getEvaluationProfileStatus,
  saveEvaluationProfile,
  startEvaluation,
  submitAnswer,
} from '../api/evaluation'
import EvaluationReport from './EvaluationReport.vue'
import { useEvaluationStream } from '../composables/useEvaluationStream'
import type { EvaluationQuestion } from '../types/evaluation'

type Phase = 'idle' | 'starting' | 'active' | 'analyzing' | 'complete' | 'error'

const phase = ref<Phase>('idle')
const sessionId = ref('')
const userId = ref('demo_user_001')
const displayName = ref('')
const showProfileInit = ref(false)
const profileInitLoading = ref(false)
const profileMissingFields = ref<string[]>([])
const nativeLanguage = ref('')
const selfAssessedLevel = ref('能进行基础日常交流')
const learningStage = ref('初级阶段')
const yearsLearningChinese = ref('')
const weeklyStudyHours = ref('')
const assessmentGoal = ref('')
const answerText = ref('')
const selectedOptionId = ref('')
const typedStem = ref('')
const currentQuestion = ref<EvaluationQuestion | null>(null)
const isSubmitting = ref(false)
const networkMessage = ref('')
const errorMessage = ref('')

let typingTimer: number | null = null

const stream = useEvaluationStream({
  onNewQuestion(payload) {
    applyQuestion(payload.question)
    phase.value = 'active'
  },
  onEvaluationComplete() {
    phase.value = 'complete'
  },
})

watch(
  () => stream.currentQuestion.value,
  (next) => {
    if (!next) return
    currentQuestion.value = next
  },
)

const isBusy = computed(() => phase.value === 'starting' || phase.value === 'analyzing')
const reportData = computed(() => stream.report.value)
const connectionStateText = computed(() => stream.connectionState.value)
const analysisFeed = computed(() => stream.analysisFeed.value)

const questionType = computed(() => {
  if (currentQuestion.value?.question_type) {
    return currentQuestion.value.question_type
  }
  return currentQuestion.value?.options?.length ? 'single_choice' : 'short_answer'
})

const isOptionQuestion = computed(
  () => questionType.value === 'single_choice' || questionType.value === 'true_false',
)

const canSubmit = computed(() => {
  if (isBusy.value || !currentQuestion.value) return false
  if (isOptionQuestion.value) return Boolean(selectedOptionId.value)
  return Boolean(answerText.value.trim())
})

const typeLabel = computed(() => {
  if (questionType.value === 'single_choice') return '单选题'
  if (questionType.value === 'true_false') return '判断题'
  if (questionType.value === 'fill_blank') return '填空题'
  return '简答题'
})

const displayedStem = computed(() => {
  if (typedStem.value.trim()) return typedStem.value
  return currentQuestion.value?.stem ?? ''
})

async function beginEvaluation() {
  try {
    if (!userId.value.trim()) {
      networkMessage.value = '请先填写用户ID，再开始评测。'
      return
    }

    const canStart = await ensureEvaluationProfileInitialized()
    if (!canStart) {
      networkMessage.value = '首次使用请先完成评测画像初始化。'
      return
    }

    phase.value = 'starting'
    errorMessage.value = ''
    networkMessage.value = ''

    const data = await startEvaluation({
      user: {
        user_id: userId.value.trim(),
        display_name: displayName.value.trim() || undefined,
      },
      reuse_active_session: true,
    })
    sessionId.value = data.session_id

    applyQuestion(data.first_question)

    stream.connect(data.session_id)
    phase.value = 'active'
  } catch (error) {
    phase.value = 'error'
    errorMessage.value = (error as Error).message
  }
}

async function ensureEvaluationProfileInitialized(): Promise<boolean> {
  const trimmedUserId = userId.value.trim()
  if (!trimmedUserId) return false

  try {
    profileInitLoading.value = true
    const status = await getEvaluationProfileStatus(trimmedUserId)
    const profile = (status.profile ?? {}) as Record<string, unknown>

    nativeLanguage.value = String(profile.native_language ?? nativeLanguage.value ?? '')
    selfAssessedLevel.value = String(
      profile.self_assessed_level ?? selfAssessedLevel.value ?? '能进行基础日常交流',
    )
    learningStage.value = String(profile.learning_stage ?? learningStage.value ?? '初级阶段')
    yearsLearningChinese.value = profile.years_learning_chinese == null ? '' : String(profile.years_learning_chinese)
    weeklyStudyHours.value = profile.weekly_study_hours == null ? '' : String(profile.weekly_study_hours)
    assessmentGoal.value = String(profile.assessment_goal ?? assessmentGoal.value ?? '')

    profileMissingFields.value = Array.isArray(status.required_missing) ? status.required_missing : []
    showProfileInit.value = !status.initialized
    return status.initialized
  } catch {
    networkMessage.value = '用户画像状态查询失败，请稍后重试。'
    return false
  } finally {
    profileInitLoading.value = false
  }
}

async function submitEvaluationProfile() {
  const trimmedUserId = userId.value.trim()
  if (!trimmedUserId) {
    networkMessage.value = '请先填写用户ID。'
    return
  }
  if (!nativeLanguage.value.trim() || !selfAssessedLevel.value.trim() || !learningStage.value.trim()) {
    networkMessage.value = '请完成必填项：母语、当前水平、学习阶段。'
    return
  }

  try {
    profileInitLoading.value = true
    const years = yearsLearningChinese.value.trim() ? Number(yearsLearningChinese.value) : undefined
    const weekly = weeklyStudyHours.value.trim() ? Number(weeklyStudyHours.value) : undefined

    const status = await saveEvaluationProfile(trimmedUserId, {
      native_language: nativeLanguage.value.trim(),
      self_assessed_level: selfAssessedLevel.value.trim(),
      learning_stage: learningStage.value.trim(),
      years_learning_chinese: Number.isFinite(years as number) ? years : undefined,
      weekly_study_hours: Number.isFinite(weekly as number) ? weekly : undefined,
      assessment_goal: assessmentGoal.value.trim() || undefined,
    })

    profileMissingFields.value = status.required_missing
    if (status.initialized) {
      showProfileInit.value = false
      networkMessage.value = ''
      await beginEvaluation()
    } else {
      networkMessage.value = '初始化未完成，请补全必填项。'
    }
  } catch (error) {
    networkMessage.value = (error as Error).message || '画像初始化失败，请稍后重试。'
  } finally {
    profileInitLoading.value = false
  }
}

async function safeSubmit() {
  if (!sessionId.value || !currentQuestion.value || isSubmitting.value) return

  const finalAnswer = isOptionQuestion.value
    ? selectedOptionId.value
    : answerText.value.trim()

  if (!finalAnswer) {
    networkMessage.value = '请先完成作答再提交。'
    return
  }

  try {
    isSubmitting.value = true
    phase.value = 'analyzing'
    stream.markAnalyzing(true)

    await submitAnswer(sessionId.value, currentQuestion.value.q_id, {
      answer: finalAnswer,
    })
  } catch (error) {
    phase.value = 'error'
    errorMessage.value = (error as Error).message
    stream.markAnalyzing(false)
  } finally {
    isSubmitting.value = false
  }
}

function selectOption(optionId: string) {
  if (!isOptionQuestion.value || isBusy.value) return
  selectedOptionId.value = optionId
  answerText.value = optionId
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

function applyQuestion(question: EvaluationQuestion) {
  currentQuestion.value = question
  answerText.value = ''
  selectedOptionId.value = ''
  runTypewriter(String(question?.stem ?? ''))
}

onBeforeUnmount(() => {
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
        <div class="w-full max-w-xl space-y-6 text-center">
          <p class="text-sm uppercase tracking-[0.22em] text-zinc-400">Ready</p>
          <h2 class="text-3xl font-semibold leading-tight sm:text-4xl">
            SSE 流式推送评测
          </h2>
          <p class="text-zinc-300/85">
            开始后将自动建立长连接并持续接收评测进度。
          </p>
          <div class="grid gap-3 rounded-2xl border border-zinc-800/70 bg-zinc-950/60 p-4 text-left">
            <label class="text-xs uppercase tracking-[0.18em] text-zinc-400">用户ID（长期记忆主键）</label>
            <input
              v-model="userId"
              class="rounded-lg border border-zinc-700 bg-zinc-900/85 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400"
              placeholder="例如：stu_10086"
            />

            <label class="text-xs uppercase tracking-[0.18em] text-zinc-400">昵称（可选）</label>
            <input
              v-model="displayName"
              class="rounded-lg border border-zinc-700 bg-zinc-900/85 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400"
              placeholder="例如：小明"
            />

          </div>
          <button
            class="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            @click="beginEvaluation"
          >
            开始评测
          </button>
          <p class="text-xs text-zinc-400">首次使用会先进入评测画像初始化（母语、当前水平、学习阶段）。</p>
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
        <div
          v-if="networkMessage"
          class="rounded-xl border border-amber-400/35 bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          <p>{{ networkMessage }}</p>
        </div>

        <article class="flex-1 rounded-2xl border border-zinc-800/80 bg-zinc-950/65 p-5">
          <p class="mb-3 text-xs uppercase tracking-[0.2em] text-emerald-300/90">
            Question {{ currentQuestion?.q_id || '--' }}
          </p>
          <p class="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-400">{{ typeLabel }}</p>
          <p class="min-h-20 whitespace-pre-wrap text-lg leading-relaxed sm:text-xl">{{ displayedStem }}</p>

          <p v-if="currentQuestion?.prompt" class="mt-4 whitespace-pre-wrap text-zinc-300/95">
            {{ currentQuestion.prompt }}
          </p>

          <ul
            v-if="isOptionQuestion && currentQuestion?.options?.length"
            class="mt-5 grid gap-3 sm:grid-cols-2"
          >
            <li
              v-for="opt in currentQuestion.options"
              :key="opt.id"
              class="rounded-lg"
            >
              <button
                class="w-full rounded-lg border px-3 py-2 text-left text-sm transition"
                :class="selectedOptionId === opt.id
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                  : 'border-zinc-700/70 bg-zinc-900/70 text-zinc-100 hover:border-zinc-500'"
                :disabled="isBusy"
                @click="selectOption(opt.id)"
              >
                {{ opt.id }}. {{ opt.text }}
              </button>
            </li>
          </ul>
        </article>

        <div class="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-4">
          <label class="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-400">你的作答</label>
          <textarea
            v-model="answerText"
            class="min-h-32 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900/85 p-3 text-zinc-100 outline-none transition focus:border-emerald-400"
            :disabled="isBusy || isOptionQuestion"
            :placeholder="isOptionQuestion ? '已选择选项后可直接提交' : '请输入你的答案...'"
          />

          <div class="mt-4 flex items-center justify-between gap-3">
            <p class="text-xs text-zinc-400">连接状态：{{ connectionStateText }}</p>
            <button
              class="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300"
              :disabled="!canSubmit"
              @click="safeSubmit()"
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
            <div class="w-full max-w-2xl space-y-4 rounded-2xl border border-zinc-700/80 bg-zinc-900/80 p-4 sm:p-5">
              <div class="text-center">
                <div class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-400" />
                <p class="mt-3 text-sm uppercase tracking-[0.24em] text-zinc-300">Agent 分析中...</p>
              </div>

              <div class="rounded-xl border border-zinc-700/70 bg-zinc-950/70 p-3">
                <p class="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-400">分析进度报告</p>
                <ul v-if="analysisFeed.length" class="max-h-64 space-y-2 overflow-y-auto pr-1">
                  <li
                    v-for="(item, idx) in analysisFeed"
                    :key="`${item.stage}-${item.server_timestamp_ms ?? idx}-${idx}`"
                    class="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-sm font-medium text-zinc-100">{{ item.title || item.stage }}</p>
                      <span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                        {{ item.agent || 'agent' }}
                      </span>
                    </div>
                    <p class="mt-1 text-xs text-zinc-300/90">{{ item.summary }}</p>
                  </li>
                </ul>
                <p v-else class="text-sm text-zinc-400">
                  正在初始化分析通道，稍后将持续展示各阶段摘要。
                </p>
              </div>
            </div>
          </div>
        </transition>
      </section>
    </main>

    <transition name="fade-slide">
      <section
        v-if="showProfileInit"
        class="fixed inset-0 z-30 grid place-items-center bg-zinc-950/90 px-4"
      >
        <div class="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6">
          <p class="text-xs uppercase tracking-[0.22em] text-emerald-300/90">Evaluation Profile Init</p>
          <h3 class="mt-2 text-2xl font-semibold">首次使用先完成评测画像</h3>
          <p class="mt-2 text-sm text-zinc-300/85">
            该画像仅用于评测系统的起始难度与测评策略，不是学习内容推荐画像。
          </p>

          <div class="mt-4 grid gap-3">
            <label class="text-xs uppercase tracking-[0.16em] text-zinc-400">母语 *</label>
            <input
              v-model="nativeLanguage"
              class="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              placeholder="例如：英语、日语、西班牙语"
            />

            <label class="text-xs uppercase tracking-[0.16em] text-zinc-400">自评中文能力 *</label>
            <select
              v-model="selfAssessedLevel"
              class="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
            >
              <option>几乎零基础（只会少量词）</option>
              <option>能进行基础日常交流</option>
              <option>能描述经历并表达观点</option>
              <option>能讨论熟悉领域的复杂话题</option>
              <option>接近流利，可处理抽象表达</option>
            </select>

            <label class="text-xs uppercase tracking-[0.16em] text-zinc-400">当前学习阶段 *</label>
            <select
              v-model="learningStage"
              class="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
            >
              <option>零基础</option>
              <option>初级阶段</option>
              <option>中级阶段</option>
              <option>中高级阶段</option>
              <option>冲刺考试阶段</option>
            </select>

            <label class="text-xs uppercase tracking-[0.16em] text-zinc-400">学习中文年限（可选）</label>
            <input
              v-model="yearsLearningChinese"
              class="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              placeholder="例如：1.5"
            />

            <label class="text-xs uppercase tracking-[0.16em] text-zinc-400">每周学习时长小时（可选）</label>
            <input
              v-model="weeklyStudyHours"
              class="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              placeholder="例如：6"
            />

            <label class="text-xs uppercase tracking-[0.16em] text-zinc-400">本次评测目标（可选）</label>
            <textarea
              v-model="assessmentGoal"
              class="min-h-20 rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              placeholder="例如：确认自己是否达到 HSK4 阅读水平"
            />
          </div>

          <p v-if="profileMissingFields.length" class="mt-3 text-xs text-amber-300">
            仍缺少字段：{{ profileMissingFields.join('、') }}
          </p>

          <div class="mt-4 flex justify-end">
            <button
              class="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-300"
              :disabled="profileInitLoading"
              @click="submitEvaluationProfile"
            >
              {{ profileInitLoading ? '提交中...' : '保存并开始评测' }}
            </button>
          </div>
        </div>
      </section>
    </transition>
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

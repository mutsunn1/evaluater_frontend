import { computed, onBeforeUnmount, ref } from 'vue'

interface UseServerTimerOptions {
  onTimeout?: () => void
}

export function useServerTimer(options: UseServerTimerOptions = {}) {
  const remainingMs = ref(0)
  const hardTimeoutMs = ref(0)
  const expectedTimeMs = ref(0)
  const isPaused = ref(true)

  let clientServerOffsetMs = 0
  let deadlineServerMs = 0
  let startedServerMs = 0
  let rafId: number | null = null
  let timeoutTriggered = false

  const elapsedMs = computed(() => Math.max(hardTimeoutMs.value - remainingMs.value, 0))

  const displaySeconds = computed(() => Math.ceil(remainingMs.value / 1000))

  const progressPercent = computed(() => {
    if (!hardTimeoutMs.value) return 0
    const consumed = hardTimeoutMs.value - remainingMs.value
    return Math.min(Math.max((consumed / hardTimeoutMs.value) * 100, 0), 100)
  })

  const isOverExpected = computed(() => elapsedMs.value > expectedTimeMs.value)

  function syncWithServer(serverTimestampMs: number) {
    clientServerOffsetMs = serverTimestampMs - Date.now()
  }

  function startCountdown(params: {
    serverTimestampMs: number
    hardTimeoutMs: number
    expectedTimeMs: number
  }) {
    syncWithServer(params.serverTimestampMs)
    hardTimeoutMs.value = params.hardTimeoutMs
    expectedTimeMs.value = params.expectedTimeMs

    startedServerMs = params.serverTimestampMs
    deadlineServerMs = params.serverTimestampMs + params.hardTimeoutMs
    timeoutTriggered = false
    isPaused.value = false

    tick()
  }

  function computeRemainingMs() {
    const nowServerMs = Date.now() + clientServerOffsetMs
    return Math.max(0, deadlineServerMs - nowServerMs)
  }

  function tick() {
    if (isPaused.value) return

    remainingMs.value = computeRemainingMs()

    if (remainingMs.value <= 0 && !timeoutTriggered) {
      timeoutTriggered = true
      isPaused.value = true
      options.onTimeout?.()
      return
    }

    rafId = window.requestAnimationFrame(tick)
  }

  function pauseLocal() {
    isPaused.value = true
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function resumeLocal(serverTimestampMs?: number) {
    if (typeof serverTimestampMs === 'number') {
      syncWithServer(serverTimestampMs)
    }

    if (remainingMs.value <= 0) return
    isPaused.value = false
    tick()
  }

  function stop() {
    pauseLocal()
    remainingMs.value = 0
    hardTimeoutMs.value = 0
    expectedTimeMs.value = 0
    deadlineServerMs = 0
    startedServerMs = 0
  }

  const consumedSinceStartMs = computed(() => {
    const nowServerMs = Date.now() + clientServerOffsetMs
    return Math.max(0, nowServerMs - startedServerMs)
  })

  onBeforeUnmount(() => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
    }
  })

  return {
    remainingMs,
    elapsedMs,
    displaySeconds,
    progressPercent,
    expectedTimeMs,
    hardTimeoutMs,
    isPaused,
    isOverExpected,
    consumedSinceStartMs,
    syncWithServer,
    startCountdown,
    pauseLocal,
    resumeLocal,
    stop,
  }
}

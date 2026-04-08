import { ref } from 'vue'
import { createEvaluationStream } from '../api/evaluation'
import type {
  EvaluationCompleteEvent,
  EvaluationQuestion,
  NewQuestionEvent,
} from '../types/evaluation'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'

interface UseEvaluationStreamOptions {
  onNewQuestion?: (payload: NewQuestionEvent) => void
  onEvaluationComplete?: (payload: EvaluationCompleteEvent) => void
}

export function useEvaluationStream(options: UseEvaluationStreamOptions = {}) {
  const currentQuestion = ref<EvaluationQuestion | null>(null)
  const isAnalyzing = ref(false)
  const isComplete = ref(false)
  const report = ref<EvaluationCompleteEvent | null>(null)
  const connectionState = ref<ConnectionState>('idle')
  const errorMessage = ref('')

  let source: EventSource | null = null
  let reconnectAttempts = 0
  let reconnectTimer: number | null = null
  let activeSessionId = ''
  let manuallyClosed = false

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function closeSource() {
    if (source) {
      source.close()
      source = null
    }
  }

  function parseJson<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  function setupSource(sessionId: string) {
    closeSource()
    source = createEvaluationStream(sessionId)
    connectionState.value = reconnectAttempts > 0 ? 'reconnecting' : 'connecting'

    source.onopen = () => {
      reconnectAttempts = 0
      connectionState.value = 'connected'
      errorMessage.value = ''
    }

    source.addEventListener('new_question', (event) => {
      const parsed = parseJson<NewQuestionEvent>((event as MessageEvent).data)
      if (!parsed) return

      currentQuestion.value = parsed.question
      isAnalyzing.value = false
      options.onNewQuestion?.(parsed)
    })

    source.addEventListener('evaluation_complete', (event) => {
      const parsed = parseJson<EvaluationCompleteEvent>((event as MessageEvent).data)
      isComplete.value = true
      isAnalyzing.value = false
      report.value = parsed
      connectionState.value = 'closed'
      options.onEvaluationComplete?.(parsed ?? {})
      disconnect()
    })

    source.onerror = () => {
      if (manuallyClosed || isComplete.value) return
      connectionState.value = 'error'
      errorMessage.value = '流连接中断，正在重连...'
      closeSource()
      scheduleReconnect(sessionId)
    }
  }

  function scheduleReconnect(sessionId: string) {
    clearReconnectTimer()
    reconnectAttempts += 1
    const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 10_000)

    reconnectTimer = window.setTimeout(() => {
      setupSource(sessionId)
    }, delay)
  }

  function connect(sessionId: string) {
    activeSessionId = sessionId
    manuallyClosed = false
    isComplete.value = false
    setupSource(sessionId)
  }

  function disconnect() {
    manuallyClosed = true
    clearReconnectTimer()
    closeSource()
    connectionState.value = 'closed'
  }

  function markAnalyzing(value: boolean) {
    isAnalyzing.value = value
  }

  function reconnectNow() {
    if (!activeSessionId) return
    reconnectAttempts = 0
    setupSource(activeSessionId)
  }

  return {
    currentQuestion,
    isAnalyzing,
    isComplete,
    report,
    connectionState,
    errorMessage,
    connect,
    disconnect,
    markAnalyzing,
    reconnectNow,
  }
}

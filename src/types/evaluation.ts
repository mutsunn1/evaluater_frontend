export interface QuestionOption {
  id: string
  text: string
}

export interface EvaluationQuestion {
  q_id: string
  stem: string
  prompt?: string
  options?: QuestionOption[]
  expected_time_ms: number
  hard_timeout_ms: number
}

export interface StartEvaluationResponse {
  session_id: string
  server_timestamp_ms: number
  first_question: EvaluationQuestion
}

export interface NewQuestionEvent {
  question: EvaluationQuestion
  server_timestamp_ms: number
}

export interface EvaluationCompleteEvent {
  report_title?: string
  report_summary?: string
  report?: Record<string, unknown>
}

export type PauseReason = 'tab_switch' | 'user_pause'

export interface SubmitPayload {
  answer: string
}

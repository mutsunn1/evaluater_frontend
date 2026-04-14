export interface QuestionOption {
  id: string
  text: string
}

export interface EvaluationQuestion {
  q_id: string
  question_type?: 'single_choice' | 'true_false' | 'fill_blank' | 'short_answer'
  stem: string
  prompt?: string
  options?: QuestionOption[]
  expected_time_sec: number
  hard_timeout_sec: number
}

export interface StartEvaluationResponse {
  session_id: string
  server_timestamp_ms: number
  first_question: EvaluationQuestion
}

export interface UserContext {
  user_id: string
  display_name?: string
  target_hsk_level?: string
  metadata?: Record<string, unknown>
}

export interface StartEvaluationPayload {
  user: UserContext
  reuse_active_session?: boolean
}

export interface EvaluationProfilePayload {
  native_language: string
  self_assessed_level: string
  learning_stage: string
  years_learning_chinese?: number
  weekly_study_hours?: number
  assessment_goal?: string
}

export interface EvaluationProfileStatusResponse {
  user_id: string
  initialized: boolean
  required_missing: string[]
  profile: Record<string, unknown>
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

export interface AnalysisProgressEvent {
  stage: string
  agent: string
  title: string
  summary: string
  confidence?: number
  server_timestamp_ms?: number
}

export interface SubmitPayload {
  answer: string
}

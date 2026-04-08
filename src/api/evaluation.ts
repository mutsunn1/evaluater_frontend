import type {
  PauseReason,
  StartEvaluationResponse,
  SubmitPayload,
} from '../types/evaluation'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function startEvaluation(): Promise<StartEvaluationResponse> {
  return request<StartEvaluationResponse>('/api/v2/evaluations/start', {
    method: 'POST',
  })
}

export async function pauseTimer(sessionId: string, reason: PauseReason): Promise<void> {
  await request<void>(`/api/v2/evaluations/${sessionId}/timer/pause`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function resumeTimer(sessionId: string): Promise<void> {
  await request<void>(`/api/v2/evaluations/${sessionId}/timer/resume`, {
    method: 'POST',
  })
}

export async function heartbeat(sessionId: string): Promise<void> {
  await request<void>(`/api/v2/evaluations/${sessionId}/timer/heartbeat`, {
    method: 'PUT',
  })
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  payload: SubmitPayload,
): Promise<void> {
  await request<void>(`/api/v2/evaluations/${sessionId}/questions/${questionId}/submit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function createEvaluationStream(sessionId: string): EventSource {
  const url = `${API_BASE_URL}/api/v2/evaluations/${sessionId}/stream`
  return new EventSource(url, { withCredentials: true })
}

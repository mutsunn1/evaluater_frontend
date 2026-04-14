import type {
  EvaluationProfilePayload,
  EvaluationProfileStatusResponse,
  StartEvaluationPayload,
  StartEvaluationResponse,
  SubmitPayload,
} from '../types/evaluation'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const REQUEST_TIMEOUT_MS = 15_000

interface RequestOptions extends RequestInit {
  timeoutMs?: number
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...requestInit } = init
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(requestInit.headers ?? {}),
      },
      ...requestInit,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function startEvaluation(payload: StartEvaluationPayload): Promise<StartEvaluationResponse> {
  return request<StartEvaluationResponse>('/api/v2/evaluations/start', {
    method: 'POST',
    body: JSON.stringify(payload),
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

export async function getUserMemory(userId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/v2/memory/users/${userId}`)
}

export async function getUserSessions(
  userId: string,
  limit = 20,
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/v2/memory/users/${userId}/sessions?limit=${limit}`)
}

export async function getSessionMemory(sessionId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/v2/memory/sessions/${sessionId}`)
}

export async function getEvaluationProfileStatus(
  userId: string,
): Promise<EvaluationProfileStatusResponse> {
  return request<EvaluationProfileStatusResponse>(
    `/api/v2/memory/users/${userId}/evaluation-profile/status`,
  )
}

export async function saveEvaluationProfile(
  userId: string,
  payload: EvaluationProfilePayload,
): Promise<EvaluationProfileStatusResponse> {
  return request<EvaluationProfileStatusResponse>(
    `/api/v2/memory/users/${userId}/evaluation-profile`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

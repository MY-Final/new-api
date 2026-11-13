import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { ShowcaseEntry, ShowcasePlan, ShowcaseRun } from './types'

interface Response<T> {
  success: boolean
  message?: string
  data: T
}

export async function getShowcase(admin = false): Promise<ShowcaseEntry[]> {
  const response = await api.get<Response<ShowcaseEntry[]>>(
    admin ? '/api/showcase/admin/plans' : '/api/showcase'
  )
  return requireServerSuccess(response.data).data
}

export async function getShowcaseRun(id: number): Promise<ShowcaseRun> {
  const response = await api.get<Response<ShowcaseRun>>(
    `/api/showcase/runs/${id}`
  )
  return requireServerSuccess(response.data).data
}

export async function saveShowcasePlan(
  plan: Partial<ShowcasePlan>
): Promise<void> {
  const response = await api.post('/api/showcase/admin/plans', plan)
  requireServerSuccess(response.data)
}

export async function deleteShowcasePlan(id: number): Promise<void> {
  const response = await api.delete(`/api/showcase/admin/plans/${id}`)
  requireServerSuccess(response.data)
}

export async function runShowcasePlan(id: number): Promise<void> {
  const response = await api.post(`/api/showcase/admin/plans/${id}/run`)
  requireServerSuccess(response.data)
}

export async function getShowcaseGroups(): Promise<string[]> {
  const response = await api.get<Response<string[]>>('/api/group/')
  return requireServerSuccess(response.data).data.filter(
    (group) => group !== 'auto'
  )
}

export async function getShowcaseModels(group: string): Promise<string[]> {
  const response = await api.get<Response<string[]>>(
    '/api/showcase/admin/models',
    { params: { group } }
  )
  return requireServerSuccess(response.data).data
}

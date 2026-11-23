import { shallowRef } from 'vue'
import {
  toRiskTablePage, validateRiskDetail,
  type RiskDetailDto, type RiskId, type RiskListParams, type RiskReader,
} from '@/api/risk/contracts'
import { apiReadError } from '@/utils/apiError'

type ListState =
  | { kind: 'idle' | 'loading' | 'ready' }
  | { kind: 'empty'; total: number }
  | { kind: 'error'; message: string }

type DetailState =
  | { kind: 'closed' }
  | { kind: 'loading'; id: RiskId }
  | { kind: 'error'; id: RiskId; message: string }
  | { kind: 'ready'; id: RiskId; record: RiskDetailDto }

export function riskReadAborted() {
  return new DOMException('风险读取已取消', 'AbortError')
}

export function useRiskReads(getReader: () => RiskReader | undefined) {
  const list = shallowRef<ListState>({ kind: 'idle' })
  const detail = shallowRef<DetailState>({ kind: 'closed' })
  let listRequest: AbortController | undefined
  let detailRequest: AbortController | undefined

  function clearList() {
    listRequest?.abort()
    listRequest = undefined
    list.value = { kind: 'idle' }
  }

  async function fetchList(params: RiskListParams) {
    const reader = getReader()
    if (!reader) throw riskReadAborted()
    listRequest?.abort()
    const request = listRequest = new AbortController()
    const isCurrent = () => !request.signal.aborted && reader === getReader()
    list.value = { kind: 'loading' }
    try {
      const data = toRiskTablePage(await reader.list(params, request.signal))
      if (!isCurrent()) throw riskReadAborted()
      list.value = data.list.length ? { kind: 'ready' } : { kind: 'empty', total: data.total }
      return data
    } catch (error) {
      if (!isCurrent()) throw riskReadAborted()
      list.value = { kind: 'error', message: apiReadError(error, '列表加载失败，请重试') }
      throw error
    } finally {
      if (request === listRequest) listRequest = undefined
    }
  }

  function closeDetail() {
    detailRequest?.abort()
    detailRequest = undefined
    detail.value = { kind: 'closed' }
  }

  async function openDetail(id: RiskId) {
    const reader = getReader()
    if (!reader) return
    detailRequest?.abort()
    const request = detailRequest = new AbortController()
    const isCurrent = () => !request.signal.aborted && reader === getReader()
    detail.value = { kind: 'loading', id }
    try {
      const record = validateRiskDetail(await reader.detail(id, request.signal), id)
      if (isCurrent()) detail.value = { kind: 'ready', id, record }
    } catch (error) {
      if (isCurrent()) {
        detail.value = { kind: 'error', id, message: apiReadError(error, '详情加载失败，请重试', '未找到该记录') }
      }
    } finally {
      if (request === detailRequest) detailRequest = undefined
    }
  }

  return { list, detail, fetchList, clearList, openDetail, closeDetail }
}

import { computed, reactive } from 'vue'
import { uploadAndConfirm } from '@/api/storage'
import type { TicketTypeFieldDef } from '@/api/ticket'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { apiErrorMessage } from '@/utils/apiError'

export interface TransitionActionForm {
  title: string
  fields: readonly { definition: TicketTypeFieldDef; required: boolean }[]
  commentRequired?: boolean
}

export interface TransitionActionInput {
  custom_data_patch: Record<string, unknown>
  comment?: string
}

type CollectionResult = { input: TransitionActionInput } | { errors: Record<string, string>; commentError?: string }

function hasValue(value: unknown) {
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0
  return value != null
}

export function collectTransitionInput(
  action: TransitionActionForm,
  values: Record<string, unknown>,
  fileKeys: Record<string, string[]>,
  comment: string,
): CollectionResult {
  const errors: Record<string, string> = Object.create(null)
  const entries: Array<[string, unknown]> = []
  for (const { definition, required } of action.fields) {
    const { field_key: key, field_type: type, field_label: label } = definition
    if (type === 'tips' || definition.field_meta?.formula) {
      errors[key] = `「${label}」的办理配置无效，请刷新工单`
      continue
    }
    const source = type === 'file' ? fileKeys : values
    // The reactive read tracks a previously absent required field.
    const value = source[key]
    if (Object.hasOwn(source, key) && hasValue(value)) {
      entries.push([key, Array.isArray(value) ? [...value] : value])
    } else if (required) {
      errors[key] = type === 'file' ? `请上传「${label}」` : `请填写「${label}」`
    }
  }
  const explanation = comment.trim()
  const commentError = action.commentRequired && !explanation ? '请填写办理说明' : undefined
  if (Object.keys(errors).length || commentError) return { errors, commentError }
  return { input: { custom_data_patch: Object.fromEntries(entries), ...(explanation && { comment: explanation }) } }
}

type ActionFile = { id: number; name: string } & (
  | { status: 'pending'; file: File }
  | { status: 'failed'; file: File; error: string; retryable: boolean }
  | { status: 'confirmed'; objectKey: string }
)

export function allowedFileMimes(field: TicketTypeFieldDef): string[] {
  return Array.isArray(field.field_options)
    ? field.field_options.filter((option): option is string => typeof option === 'string')
    : []
}

export function createActionFileQueue() {
  const state = reactive<Record<string, ActionFile[]>>(Object.create(null))
  const hasUnconfirmed = computed(() => Object.values(state).some(files => files.some(file => file.status !== 'confirmed')))
  let sequence = 0
  let formGeneration = 0

  function reset() {
    formGeneration++
    for (const key of Object.keys(state)) delete state[key]
  }

  function remove(key: string, id: number) {
    state[key] = state[key].filter(file => file.id !== id)
  }

  async function upload(key: string, entry: Extract<ActionFile, { status: 'pending' }>, current: () => boolean) {
    try {
      const { object_key: objectKey, purpose, status } = await uploadAndConfirm(entry.file, 'attachment_create')
      if (status !== 'confirmed' || purpose !== 'attachment_create' || typeof objectKey !== 'string' || !objectKey.trim()) {
        throw new Error('未收到有效的附件确认，请重新上传')
      }
      if (!current()) return
      const files = state[key]
      if (files.some(file => file.status === 'confirmed' && file.objectKey === objectKey)) {
        remove(key, entry.id)
      } else {
        const { id, name } = entry
        state[key] = files.map(file => file.id === id ? { id, name, status: 'confirmed', objectKey } : file)
      }
    } catch (error) {
      if (!current()) return
      const fallback = error instanceof Error && !('response' in error) ? error.message : '上传失败，请重试'
      const failed: ActionFile = { ...entry, status: 'failed', error: apiErrorMessage(error, fallback), retryable: true }
      state[key] = state[key].map(file => file.id === entry.id ? failed : file)
    }
  }

  function checkGeneration() {
    const form = formGeneration
    const session = getSessionGeneration()
    return () => form === formGeneration && session === getSessionGeneration()
  }

  async function add(field: TicketTypeFieldDef, files: File[]) {
    const key = field.field_key
    const mimes = allowedFileMimes(field)
    const current = checkGeneration()
    const entries = files.map<ActionFile>(file => {
      const entry = { id: ++sequence, name: file.name, file }
      if (mimes.length && !mimes.includes(file.type)) {
        return { ...entry, status: 'failed', error: `文件类型 ${file.type || '未知'} 不在允许范围内`, retryable: false }
      }
      return { ...entry, status: 'pending' }
    })
    state[key] = [...(state[key] ?? []), ...entries]
    for (const entry of entries) {
      if (!current()) return
      if (entry.status === 'pending') await upload(key, entry, current)
    }
  }

  async function retry(field: TicketTypeFieldDef, id: number) {
    const key = field.field_key
    const file = state[key]?.find(entry => entry.id === id)
    if (file?.status !== 'failed' || !file.retryable) return
    const pending = { id, name: file.name, file: file.file, status: 'pending' as const }
    state[key] = state[key].map(entry => entry.id === id ? pending : entry)
    await upload(key, pending, checkGeneration())
  }

  function keys(): Record<string, string[]> {
    return Object.fromEntries(Object.entries(state).map(([key, files]) => [key, files.flatMap(file => file.status === 'confirmed' ? [file.objectKey] : [])]))
  }

  return { state, hasUnconfirmed, reset, add, retry, remove, keys }
}

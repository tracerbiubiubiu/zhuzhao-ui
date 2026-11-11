import { onScopeDispose, ref, watch } from 'vue'

const PREFIX = 'richtext-draft:v2:'

/** 无用户身份时不持久化；JSON 元组避免账号/类型/字段的分隔符碰撞。 */
export function richtextDraftKey(userId: string | undefined, type: string, field: string): string | undefined {
  return userId && type ? `${PREFIX}${JSON.stringify([userId, type, field])}` : undefined
}

/** 旧 key 无属主，不能迁移给当前账号；仅清理旧草稿，不影响其他本地偏好。 */
export function removeLegacyRichtextDrafts() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    keys.forEach((key) => {
      if (key?.startsWith('richtext-draft:') && !key.startsWith(PREFIX)) localStorage.removeItem(key)
    })
  } catch { /* 禁止 storage 时编辑器仍可用 */ }
}

/** 草稿生命周期与组件 scope 同源；提交 clear 后卸载不得重新写回。 */
export function useRichtextDraft(model: () => string, key: () => string | undefined, emit: (value: string) => void) {
  const content = ref(model() || '')
  const draftRestored = ref(false)
  const draftTimestamp = ref(0)
  let initialValue = content.value
  let activeKey: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let syncing = false
  let cleared = false

  const cancel = () => { clearTimeout(timer); timer = undefined }
  const remove = () => {
    try { if (activeKey) localStorage.removeItem(activeKey) } catch { /* storage 降级 */ }
  }
  const save = () => {
    if (!activeKey || cleared) return
    try {
      if (content.value.trim()) localStorage.setItem(activeKey, JSON.stringify({ content: content.value, ts: Date.now() }))
      else remove()
    } catch { /* 配额/隐私模式不阻断输入或提交 */ }
  }
  const assign = (value: string, notify: boolean) => {
    syncing = true
    content.value = value
    syncing = false
    if (notify) emit(value)
  }

  watch(content, (value) => {
    if (syncing) return
    emit(value)
    cleared = false
    cancel()
    if (!value.trim()) remove()
    else if (activeKey) timer = setTimeout(save, 2000)
  }, { flush: 'sync' })

  watch(key, (nextKey) => {
    cancel()
    save() // 切类型时保留当前类型的输入，不让旧 timer 写入新类型
    activeKey = nextKey
    cleared = false
    initialValue = model() || ''
    draftRestored.value = false
    assign(initialValue, false)
    removeLegacyRichtextDrafts()
    if (!activeKey) return
    try {
      const raw = localStorage.getItem(activeKey)
      if (!raw) return
      const draft = JSON.parse(raw) as { content?: unknown; ts?: unknown }
      if (typeof draft.content !== 'string' || typeof draft.ts !== 'number') { remove(); return }
      if (draft.content.trim() && draft.content !== initialValue) {
        draftTimestamp.value = draft.ts
        draftRestored.value = true
        assign(draft.content, true)
      }
    } catch { remove() }
  }, { immediate: true, flush: 'sync' })

  watch(model, (value) => {
    if (value !== content.value) {
      cancel()
      assign(value || '', false)
    }
  }, { flush: 'sync' })

  function clearDraft() {
    cancel()
    remove()
    cleared = true
    draftRestored.value = false
  }

  function discardDraft() {
    clearDraft()
    assign(initialValue, true)
  }

  onScopeDispose(() => { cancel(); save() })
  return { content, draftRestored, draftTimestamp, clearDraft, discardDraft }
}

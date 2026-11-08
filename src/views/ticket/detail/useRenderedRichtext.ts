import { onScopeDispose, ref, watch } from 'vue'

export interface RichtextSource {
  key: string
  src: string
}

/** 详情字段只消费服务端消毒的 HTML；缓存随字段源内容更新。 */
export function useRenderedRichtext(sources: () => RichtextSource[], render: (src: string) => Promise<string>) {
  const renderedHtml = ref<Record<string, { src: string; html: string }>>({})
  const activeRequests = new Map<string, object>()

  async function renderField(key: string, src: string, request: object) {
    let html = ''
    try { html = await render(src) } catch { /* 请求层提示失败；不把未消毒源文本交给 v-html */ }
    // 源字符串不足以判新鲜度：A→B→A 的第一次 A 仍须作废。
    if (activeRequests.get(key) !== request) return
    renderedHtml.value[key] = { src, html }
  }

  watch(sources, (items) => {
    const next: typeof renderedHtml.value = Object.create(null)
    const pending: Array<() => void> = []
    for (const { key, src } of items) {
      if (!src) continue
      const previous = renderedHtml.value[key]
      if (previous?.src === src) {
        next[key] = previous
        continue
      }
      next[key] = { src, html: '' }
      const request = {}
      activeRequests.set(key, request)
      pending.push(() => { void renderField(key, src, request) })
    }
    // 清空数据与 schema 移除均立即撤销旧 HTML 和在途写入资格。
    for (const key of activeRequests.keys()) {
      if (!Object.hasOwn(next, key)) activeRequests.delete(key)
    }
    renderedHtml.value = next
    pending.forEach((run) => run())
  }, { immediate: true, flush: 'sync' }) // 同 tick 的清空/恢复也必须形成取消边界

  onScopeDispose(() => { activeRequests.clear() })
  return renderedHtml
}

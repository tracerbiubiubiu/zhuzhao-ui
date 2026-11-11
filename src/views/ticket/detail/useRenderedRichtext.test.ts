import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useRenderedRichtext, type RichtextSource } from './useRenderedRichtext'

const scopes: EffectScope[] = []
afterEach(() => { scopes.splice(0).forEach((scope) => scope.stop()) })

function detail(initial: RichtextSource[] = [{ key: 'body', src: 'A' }]) {
  const sources = ref(initial)
  const requests: Array<{ src: string; resolve: (html: string) => void; reject: (err: Error) => void }> = []
  const scope = effectScope()
  scopes.push(scope)
  const renderedHtml = scope.run(() => useRenderedRichtext(() => sources.value, (src) => new Promise<string>((resolve, reject) => {
    requests.push({ src, resolve, reject })
  })))!
  return { sources, requests, renderedHtml, scope }
}

async function settle() {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

describe('详情 richtext 缓存的新鲜度与生命周期', () => {
  it('同源刷新复用已渲染内容，不重复请求', async () => {
    const d = detail()
    d.requests[0]!.resolve('<p>A</p>')
    await settle()
    d.sources.value = [{ key: 'body', src: 'A' }]
    await settle()
    expect(d.requests).toHaveLength(1)
    expect(d.renderedHtml.value.body?.html).toBe('<p>A</p>')
  })

  it('字段清空立即删除已有 HTML', async () => {
    const d = detail()
    d.requests[0]!.resolve('<p>A</p>')
    await settle()
    d.sources.value = [{ key: 'body', src: '' }]
    await settle()
    expect(d.renderedHtml.value.body).toBeUndefined()
    expect(d.requests).toHaveLength(1)
  })

  it('字段清空后旧请求不能把内容写回', async () => {
    const d = detail()
    d.sources.value = [{ key: 'body', src: '' }]
    await settle()
    d.requests[0]!.resolve('<p>已清空</p>')
    await settle()
    expect(d.renderedHtml.value.body).toBeUndefined()
  })

  it('schema 移除字段后清缓存，晚到响应不能复活该字段', async () => {
    const d = detail()
    d.sources.value = []
    await settle()
    expect(d.renderedHtml.value).toEqual({})
    d.requests[0]!.resolve('<p>旧字段</p>')
    await settle()
    expect(d.renderedHtml.value).toEqual({})
  })

  it('新内容先完成时旧响应不得覆盖它', async () => {
    const d = detail()
    d.sources.value = [{ key: 'body', src: 'B' }]
    await settle()
    d.requests[1]!.resolve('<p>B</p>')
    await settle()
    d.requests[0]!.resolve('<p>A</p>')
    await settle()
    expect(d.renderedHtml.value.body).toEqual({ src: 'B', html: '<p>B</p>' })
  })

  it('A→B→A 用请求身份区分两次 A，不能只比较源字符串', async () => {
    const d = detail()
    // 同一 tick 连续改变，取消边界不能依赖默认 watcher 的批处理。
    d.sources.value = [{ key: 'body', src: 'B' }]
    d.sources.value = [{ key: 'body', src: 'A' }]
    await settle()
    expect(d.requests.map((r) => r.src)).toEqual(['A', 'B', 'A'])
    d.requests[2]!.resolve('<p>最新 A</p>')
    await settle()
    d.requests[1]!.resolve('<p>B</p>')
    d.requests[0]!.resolve('<p>最早 A</p>')
    await settle()
    expect(d.renderedHtml.value.body?.html).toBe('<p>最新 A</p>')
  })

  it('字段移除后以同源重新加入，也不能接纳移除前的响应', async () => {
    const d = detail()
    d.sources.value = []
    d.sources.value = [{ key: 'body', src: 'A' }]
    await settle()
    expect(d.requests).toHaveLength(2)
    d.requests[1]!.resolve('<p>重新加入</p>')
    await settle()
    d.requests[0]!.resolve('<p>移除前</p>')
    await settle()
    expect(d.renderedHtml.value.body?.html).toBe('<p>重新加入</p>')
  })

  it('多个字段独立渲染，其他字段改变不丢弃未变字段的在途结果', async () => {
    const d = detail([{ key: 'body', src: 'A' }, { key: 'note', src: 'N' }])
    expect(d.requests.map((r) => r.src)).toEqual(['A', 'N'])
    d.sources.value = [{ key: 'body', src: 'A' }, { key: 'note', src: 'M' }]
    await settle()
    d.requests[0]!.resolve('<p>A</p>')
    d.requests[2]!.resolve('<p>M</p>')
    await settle()
    d.requests[1]!.resolve('<p>N</p>')
    await settle()
    expect(d.renderedHtml.value).toEqual({ body: { src: 'A', html: '<p>A</p>' }, note: { src: 'M', html: '<p>M</p>' } })
  })

  it('scope 销毁后在途结果不再回写', async () => {
    const d = detail()
    const before = JSON.stringify(d.renderedHtml.value)
    d.scope.stop()
    d.requests[0]!.resolve('<p>卸载后</p>')
    await settle()
    expect(JSON.stringify(d.renderedHtml.value)).toBe(before)
  })

  it('渲染失败不把 Markdown 或 HTML 源当作已消毒结果回退', async () => {
    const d = detail([{ key: 'body', src: '<img src=x onerror=alert(1)>' }])
    d.requests[0]!.reject(new Error('offline'))
    await settle()
    expect(d.renderedHtml.value.body?.html).toBe('')
  })
})

import * as elementPlus from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, renderPage, deferred, httpError, settle } from '@/test/sfcHarness'
import source from './index.vue?raw'
preparePage(source)
function setup() {
  const api = { queryIntelApi: vi.fn() }
  const message = { warning: vi.fn() }
  const { page } = setupPage(source, {
    '@/api/intel': api, 'element-plus': { ...elementPlus, ElMessage: message },
    '@/store/modules/user': { useUserStore: () => ({ profile: { employee_no: 'synthetic-intel' } }) },
    './IntelResult.vue': {},
  })
  return { page, api }
}
const result = (type: string, value: string) => ({ type, value, result: { synthetic: value }, stale: false, fetched_at: '2026-11-20T00:00:00Z', hit_count: 0 })
beforeEach(() => localStorage.clear())
function queryNodes(node: any): any[] {
  if (!node || typeof node !== 'object' || node.props?.name === 'history') return []
  const children = Array.isArray(node.children) ? node.children : node.children?.default?.() ?? []
  return [node, ...children.flatMap(queryNodes)]
}
describe('情报查询与历史会话', () => {
  it.each([null, false, 0, '', {}, []])('合法 JSON %j 成功后展示结果，不回到未查询引导', async payload => {
    const { page, api } = setup()
    page.value.value = '192.0.2.1'
    page.resultView.value = 'raw'
    api.queryIntelApi.mockResolvedValueOnce({ ...result('ip', '192.0.2.1'), result: payload })
    await page.query()
    const nodes = queryNodes(renderPage(source, page))
    expect(nodes.find(node => node.type === 'pre')?.children).toBe(JSON.stringify(payload, null, 2))
    expect(nodes.some(node => node.props?.description === '输入查询值开始')).toBe(false)
    expect(page.history.value).toHaveLength(1)
  })
  it('stale 成功只说明返回过期缓存；真实失败清除当前结果且不追加成功历史', async () => {
    const { page, api } = setup()
    page.value.value = '192.0.2.1'
    page.resultView.value = 'raw'
    api.queryIntelApi.mockResolvedValueOnce({ ...result('ip', '192.0.2.1'), stale: true }).mockRejectedValueOnce(httpError(503, '上游暂不可用'))
    await page.query()
    const nodes = queryNodes(renderPage(source, page))
    const cacheTag = nodes.find(node => node.type === elementPlus.ElTag && node.props?.type === 'warning')
    const text = cacheTag?.children?.default?.().map((node: any) => node.children).join('') ?? ''
    expect(text).toMatch(/过期缓存|陈旧缓存/)
    expect(text).not.toContain('配额耗尽')
    expect(page.queryError.value).toBe('')
    await page.query()
    expect(page.queryError.value).toContain('上游暂不可用')
    expect(queryNodes(renderPage(source, page)).some(node => node.type === 'pre')).toBe(false)
    expect(page.history.value).toHaveLength(1)
  })
  it('选择历史只回填并回查询页，显式查询后才请求', async () => {
    const { page, api } = setup()
    page.activeTab.value = 'history'
    page.rerun({ type: 'domain', value: 'synthetic.invalid' })
    expect(api.queryIntelApi).not.toHaveBeenCalled()
    expect(page.activeTab.value).toBe('query')
    expect(page.intelType.value).toBe('domain')
    expect(page.value.value).toBe('synthetic.invalid')
    api.queryIntelApi.mockResolvedValueOnce(result('domain', 'synthetic.invalid'))
    await page.query()
    expect(api.queryIntelApi).toHaveBeenCalledWith('domain', 'synthetic.invalid')
  })
  it('查询中编辑类型不改变结果标题和历史归属', async () => {
    const { page, api } = setup()
    const pending = deferred()
    api.queryIntelApi.mockReturnValueOnce(pending.promise)
    page.intelType.value = 'domain'
    page.value.value = 'first.invalid'
    const p = page.query()
    page.intelType.value = 'ip'
    page.value.value = '192.0.2.1'
    pending.resolve(result('domain', 'first.invalid'))
    await p
    expect(page.lastType?.value).toBe('domain')
    expect(page.lastValue.value).toBe('first.invalid')
    expect(page.history.value[0]).toMatchObject({ type: 'domain', value: 'first.invalid' })
  })
  it.each([true, false])('多次显式查询只接受最新结果，旧 success=%s 不结束 loading', async success => {
    const { page, api } = setup()
    const old = deferred(), next = deferred()
    api.queryIntelApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    page.value.value = '192.0.2.1'
    const p = page.query()
    page.value.value = '192.0.2.2'
    const q = page.query()
    if (success) old.resolve(result('ip', '192.0.2.1'))
    else old.reject(new Error('network'))
    await p
    expect(page.result.value).toBe(null)
    expect(page.loading.value).toBe(true)
    next.resolve(result('ip', '192.0.2.2'))
    await q
    expect(page.lastValue.value).toBe('192.0.2.2')
    expect(page.result.value).toEqual({ synthetic: '192.0.2.2' })
    await settle()
  })
})

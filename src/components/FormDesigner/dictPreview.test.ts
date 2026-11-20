import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { preparePage, setupPage, deferred, settle, httpError } from '@/test/sfcHarness'
import * as schema from './schemaAdapter'
import * as types from './types'
import source from './PropertyPane.vue?raw'
preparePage(source)
function setup() {
  const props = reactive({ field: { dictRef: '', field_type: 'select' }, selected: 0, keyErr: '', regexErr: '' })
  const api = { listDictTypesApi: vi.fn().mockResolvedValue({ list: [] }), getDictItemsByCodeApi: vi.fn() }
  const { page } = setupPage(source, { 'element-plus': {}, '@/api/system/dict': api, './schemaAdapter': schema, './types': types }, props)
  return { page, props, api }
}
describe('字段设计器字典预览归属', () => {
  it.each([true, false])('切字典或字段后旧回包 success=%s 不污染新预览', async success => {
    const { page, props, api } = setup()
    const old = deferred(), next = deferred()
    api.getDictItemsByCodeApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    props.field.dictRef = 'a'
    await settle()
    props.field = { dictRef: 'b', field_type: 'select' }
    await settle()
    if (success) old.resolve([{ code: 'a', label: '旧选项' }])
    else old.reject(httpError(403))
    await settle()
    expect(page.dictPreview.value).toEqual([])
    expect(page.dictPreviewLoading?.value).toBe(true)
    next.resolve([{ code: 'b', label: '当前选项' }])
    await settle()
    expect(page.dictPreview.value).toEqual([{ code: 'b', label: '当前选项' }])
  })
  it('预览故障独立于成功空集且可重试', async () => {
    const { page, props, api } = setup()
    api.getDictItemsByCodeApi.mockRejectedValueOnce(httpError(503, '预览故障')).mockResolvedValueOnce([])
    props.field.dictRef = 'a'
    await settle()
    expect(page.dictPreviewError?.value ?? '').toContain('预览故障')
    await page.loadDictPreview()
    expect(page.dictPreviewError.value).toBe('')
    expect(page.dictPreview.value).toEqual([])
  })
})

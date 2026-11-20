import { expect, it, vi } from 'vitest'
import { preparePage, setupPage, renderPage, findNode } from '@/test/sfcHarness'
import source from './IntelResult.vue?raw'
preparePage(source)

it.each([false, 0, '192.0.2.1'])('标量 %s 通过原生 button 支持键盘激活和复制', async data => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  try {
    const { page } = setupPage(source, { 'element-plus': { ElMessage: { success() {}, error() {} } } }, { data })
    const node = findNode(renderPage(source, page, { data }), n => n.type === 'button')
    expect(node, '可复制标量须为原生键盘按钮').toBeDefined()
    expect(node.props.type).toBe('button')
    await node.props.onClick()
    expect(writeText).toHaveBeenCalledWith(String(data))
  } finally { vi.unstubAllGlobals() }
})

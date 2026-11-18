import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { getMenuTreeApi } from './menu'

vi.mock('@vea/request', () => ({ default: { get: vi.fn() } }))
const menu = { id: '9007199254740993', parent_id: null, name: '合成菜单', menu_type: 2 }
beforeEach(() => vi.clearAllMocks())

describe('角色覆盖前的菜单树读取边界', () => {
  it.each([undefined, null, {}, [null], [{ ...menu, id: 9007199254740992 }], [{ ...menu, id: '0' }], [{ ...menu, name: '' }], [{ ...menu, menu_type: 9 }], [{ ...menu, children: {} }], [menu, menu], [{ ...menu, children: [menu] }]])('失败或不完整菜单树不能作为成功空集合：%j', async (data) => {
    vi.mocked(request.get).mockResolvedValue(data as never)
    await expect(getMenuTreeApi()).rejects.toThrow()
  })

  it('显式空树与精确大ID成功，安全整数兼容仅转为精确字符串', async () => {
    vi.mocked(request.get).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ ...menu, children: [{ ...menu, id: 12, parent_id: menu.id }] }] as never)
    await expect(getMenuTreeApi()).resolves.toEqual([])
    await expect(getMenuTreeApi()).resolves.toEqual([{ ...menu, children: [{ ...menu, id: '12', parent_id: menu.id }] }])
  })
})

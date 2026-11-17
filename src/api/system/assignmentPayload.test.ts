import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { getUserOrgsApi, getUserRoleIdsApi, setUserOrgsApi, setUserRolesApi } from './user'
import { listRolesApi } from './role'

vi.mock('@vea/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const role = { id: '9007199254740993', name: '合成角色', code: 'synthetic_role', status: 0 }
const org = { user_id: '12', org_id: '9007199254740993', is_primary: true, joined_at: '2026-11-17T00:00:00Z' }

beforeEach(() => vi.clearAllMocks())

describe('IAM 整体替换读取载荷', () => {
  it.each([undefined, null, {}, { role_ids: null }, { role_ids: '1' }, { role_ids: [''] }, { role_ids: ['0'] }, { role_ids: [9007199254740992] }, { role_ids: ['9223372036854775808'] }, { role_ids: ['1', 1] }])('角色读取坏载荷拒绝而非成功空集合：%j', async (data) => {
    vi.mocked(request.get).mockResolvedValue(data as never)
    await expect(getUserRoleIdsApi('12')).rejects.toThrow()
  })

  it('合法空角色与精确大ID成功，保留安全整数兼容', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ role_ids: [] } as never).mockResolvedValueOnce({ role_ids: [12, role.id] } as never)
    await expect(getUserRoleIdsApi('12')).resolves.toEqual([])
    await expect(getUserRoleIdsApi('12')).resolves.toEqual(['12', role.id])
  })

  it.each([undefined, {}, { orgs: null }, { orgs: {} }, { orgs: [{ ...org, user_id: '13' }] }, { orgs: [{ ...org, org_id: 9007199254740992 }] }, { orgs: [{ ...org, is_primary: 'true' }] }, { orgs: [org, org] }, { orgs: [org, { ...org, org_id: '2' }] }])('组织读取坏载荷/串用户/多主组织拒绝：%j', async (data) => {
    vi.mocked(request.get).mockResolvedValue(data as never)
    await expect(getUserOrgsApi('12')).rejects.toThrow()
  })

  it('合法空组织与精确大ID成功', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ orgs: [] } as never).mockResolvedValueOnce({ orgs: [org] } as never)
    await expect(getUserOrgsApi('12')).resolves.toEqual([])
    await expect(getUserOrgsApi('12')).resolves.toEqual([org])
  })

  it.each([undefined, {}, [role, role], [{ ...role, id: 9007199254740992 }], [{ ...role, status: 2 }], [{ ...role, name: null }], [{ ...role, code: undefined }]])('角色字典坏载荷拒绝：%j', async (data) => {
    vi.mocked(request.get).mockResolvedValue(data as never)
    await expect(listRolesApi()).rejects.toThrow()
  })

  it('字典保留停用角色供已有绑定回显', async () => {
    vi.mocked(request.get).mockResolvedValue([role] as never)
    await expect(listRolesApi()).resolves.toEqual([role])
  })

  it('保存仍发十进制字符串数组，组织primary未指定的旧wire不改变', async () => {
    vi.mocked(request.post).mockResolvedValue(null as never)
    await setUserRolesApi('12', [role.id])
    await setUserOrgsApi('12', [], null)
    expect(request.post).toHaveBeenNthCalledWith(1, '/api/v1/users/roles', { user_id: '12', role_ids: [role.id] }, { _silentError: true })
    expect(request.post).toHaveBeenNthCalledWith(2, '/api/v1/users/orgs', { user_id: '12', org_ids: [] }, { _silentError: true })
  })
})

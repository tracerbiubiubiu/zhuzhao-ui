import { describe, expect, it, vi } from 'vitest'
import type { RoleRow } from '@/api/system/role'
import type { UserOrgRow } from '@/api/system/user'
import type { OrgTreeNode } from '@/api/system/org'
import { createOrgsEditor, createRolesEditor } from './assignmentEditors'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const user = (id: string) => ({ id, username: `合成${id}` })
const role = (id = '1', status = 1): RoleRow => ({ id, code: `synthetic_${id}`, name: `合成角色${id}`, status, description: '', priority: 100, parent_id: null, sort_order: 0, version: 1, created_at: '' })
const org = (id = '1'): OrgTreeNode => ({ id, code: `synthetic_${id}`, name: `合成组织${id}`, description: '', parent_id: null, path: id, status: 1, is_virtual: false, is_system: false, sort_order: 0, owner_user_ids: [], ticket_visibility: 'project_isolated', version: 1 })
const member = (orgId = '1', userId = '12', primary = false): UserOrgRow => ({ user_id: userId, org_id: orgId, is_primary: primary, joined_at: '' })
function rolesFixture() {
  const deps = { loadIds: vi.fn(async (_id: string): Promise<string[]> => ['1']), loadOptions: vi.fn(async () => [role(), role('2', 0)]), save: vi.fn(async (_id: string, _ids: string[]) => {}), hasPermission: vi.fn(() => true), success: vi.fn() }
  return { deps, editor: createRolesEditor(deps) }
}
function orgsFixture() {
  const deps = { loadTree: vi.fn(async (): Promise<OrgTreeNode[]> => [org(), org('2')]), loadMemberships: vi.fn(async (_id: string) => [member()]), prepareTree: vi.fn(async (_draft: unknown, _current: () => boolean) => {}), confirm: vi.fn(async () => true), save: vi.fn(async (_id: string, _ids: string[], _primary: string | null) => {}), hasPermission: vi.fn(() => true), success: vi.fn() }
  return { deps, editor: createOrgsEditor(deps) }
}

describe('角色编辑成功快照与整体替换', () => {
  it('读取及字典均成功前零POST；读取失败不变成成功空集合，重试后可保存', async () => {
    const { editor, deps } = rolesFixture()
    const read = deferred<string[]>()
    deps.loadIds.mockReturnValueOnce(read.promise)
    const loading = editor.open(user('12'))
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    read.reject(new Error('读取失败'))
    await loading
    expect(editor.state.ready).toBe(false)
    expect(editor.state.error).toContain('读取失败')
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    await editor.retry()
    await editor.submit()
    expect(deps.save).toHaveBeenCalledWith('12', ['1'])
  })

  it('字典失败不回退旧缓存；未知已绑ID不能静默取交集后保存', async () => {
    const { editor, deps } = rolesFixture()
    await editor.open(user('12'))
    editor.close()
    deps.loadOptions.mockRejectedValueOnce(new Error('字典失败'))
    await editor.open(user('13'))
    expect(editor.state.draft).toBeNull()
    await editor.submit()
    deps.loadIds.mockResolvedValueOnce(['999'])
    await editor.retry()
    expect(editor.state.ready).toBe(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('保留停用直接绑定、大ID；不可新增停用项；合法空集合能明确清空', async () => {
    const { editor, deps } = rolesFixture()
    const id = '9007199254740993'
    deps.loadOptions.mockResolvedValue([role(id, 0), role('2', 0)])
    deps.loadIds.mockResolvedValue([id])
    await editor.open(user('12'))
    expect(editor.state.draft!.selected).toEqual([id])
    editor.state.draft!.selected.push('2')
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    expect(editor.state.draft!.selected).toEqual([id, '2'])
    editor.state.draft!.selected = [id]
    deps.save.mockRejectedValueOnce(new Error('保存失败'))
    await editor.submit()
    expect(deps.save).toHaveBeenLastCalledWith('12', [id])
    expect(editor.state.draft!.selected).toEqual([id])
    editor.state.draft!.selected = []
    await editor.submit()
    expect(deps.save).toHaveBeenLastCalledWith('12', [])
    expect(editor.state.visible).toBe(false)
  })

  it('函数直接重入也只有一笔；payload在首个await前拍下，旧finally不解锁新目标', async () => {
    const { editor, deps } = rolesFixture()
    const saveA = deferred<void>(), saveB = deferred<void>()
    deps.save.mockReturnValueOnce(saveA.promise).mockReturnValueOnce(saveB.promise)
    await editor.open(user('12'))
    const first = editor.submit()
    editor.state.draft!.selected.splice(0)
    const duplicate = editor.submit()
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(deps.save).toHaveBeenNthCalledWith(1, '12', ['1'])
    editor.close()
    await editor.open(user('13'))
    const second = editor.submit()
    saveA.resolve()
    await Promise.all([first, duplicate])
    expect(editor.state.visible).toBe(true)
    expect(editor.state.target!.id).toBe('13')
    expect(editor.state.saving).toBe(true)
    expect(deps.success).not.toHaveBeenCalled()
    saveB.reject(new Error('乙保存失败'))
    await second
    expect(editor.state.saving).toBe(false)
    expect(editor.state.error).toContain('乙保存失败')
    expect(editor.state.draft!.selected).toEqual(['1'])
  })

  it('权限撤销后按钮之外的submit也不发POST', async () => {
    const { editor, deps } = rolesFixture()
    await editor.open(user('12'))
    deps.hasPermission.mockReturnValue(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it.each(Array.from({ length: 8 }, (_, i) => i + 1))('错序第%d轮：关闭重开同人/换目标、旧成功或失败均不能覆盖新快照', async (round) => {
    const { editor, deps } = rolesFixture()
    const old = deferred<string[]>()
    deps.loadIds.mockReturnValueOnce(old.promise).mockResolvedValueOnce(['2'])
    const first = editor.open(user('12'))
    editor.close()
    const id = round % 2 ? '12' : '13'
    await editor.open(user(id))
    if (round % 3) old.resolve(['1'])
    else old.reject(new Error('旧失败'))
    await first
    expect(editor.state.target!.id).toBe(id)
    expect(editor.state.draft!.selected).toEqual(['2'])
    expect(editor.state.ready).toBe(true)
    expect(editor.state.loading).toBe(false)
    expect(editor.state.error).toBe('')
  })
})

describe('组织编辑：树渲染、确认与请求隔离', () => {
  it('树准备完成前不可保存，已绑ID不可被树自动取交集丢失', async () => {
    const { editor, deps } = orgsFixture()
    const mounted = deferred<void>()
    deps.prepareTree.mockReturnValueOnce(mounted.promise)
    const load = editor.open(user('12'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(editor.state.ready).toBe(false)
    await editor.submit()
    expect(deps.confirm).not.toHaveBeenCalled()
    mounted.resolve()
    await load
    expect(editor.state.ready).toBe(true)
    deps.loadMemberships.mockResolvedValueOnce([member('999')])
    await editor.open(user('13'))
    expect(editor.state.ready).toBe(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('确认期间连点只有一个确认；取消释放锁；拍下目标/集合/primary后不读新草稿', async () => {
    const { editor, deps } = orgsFixture()
    const confirm = deferred<boolean>()
    deps.confirm.mockReturnValueOnce(confirm.promise)
    await editor.open(user('12'))
    editor.state.draft!.primary = '1'
    const first = editor.submit()
    const duplicate = editor.submit()
    expect(deps.confirm).toHaveBeenCalledTimes(1)
    editor.state.draft!.selected = ['2']
    editor.state.draft!.primary = '2'
    confirm.resolve(true)
    await Promise.all([first, duplicate])
    expect(deps.save).toHaveBeenCalledWith('12', ['1'], '1')
    await editor.open(user('13'))
    deps.confirm.mockResolvedValueOnce(false)
    await editor.submit()
    expect(editor.state.saving).toBe(false)
    expect(editor.state.visible).toBe(true)
  })

  it('确认前换目标/关闭，旧确认不能发请求，也不能解锁新确认', async () => {
    const { editor, deps } = orgsFixture()
    const old = deferred<boolean>(), current = deferred<boolean>()
    deps.confirm.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await editor.open(user('12'))
    const first = editor.submit()
    editor.close()
    await editor.open(user('13'))
    const second = editor.submit()
    old.resolve(true)
    await first
    expect(deps.save).not.toHaveBeenCalled()
    expect(editor.state.saving).toBe(true)
    current.resolve(true)
    await second
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(deps.save).toHaveBeenCalledWith('13', ['1'], null)
  })

  it('主组织悬空或树载荷坏不发请求；保存失败保留草稿；合法空集合仍可保存', async () => {
    const { editor, deps } = orgsFixture()
    await editor.open(user('12'))
    editor.state.draft!.primary = '2'
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    editor.state.draft!.primary = '1'
    deps.save.mockRejectedValueOnce(new Error('后端拒绝'))
    await editor.submit()
    expect(editor.state.draft!.selected).toEqual(['1'])
    expect(editor.state.draft!.primary).toBe('1')
    expect(editor.state.error).toContain('后端拒绝')
    editor.state.draft!.selected = []
    editor.state.draft!.primary = ''
    await editor.submit()
    expect(deps.save).toHaveBeenLastCalledWith('12', [], null)
    deps.loadTree.mockResolvedValueOnce({} as OrgTreeNode[])
    await editor.open(user('14'))
    expect(editor.state.ready).toBe(false)
  })

  it('渲染await后重开时prepare拿到的current已失效', async () => {
    const { editor, deps } = orgsFixture()
    const tick = deferred<void>()
    let staleWasCurrent = true
    deps.prepareTree.mockImplementationOnce(async (_draft, current) => {
      await tick.promise
      staleWasCurrent = current()
    })
    const old = editor.open(user('12'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    editor.close()
    await editor.open(user('13'))
    tick.resolve()
    await old
    expect(staleWasCurrent).toBe(false)
    expect(editor.state.target!.id).toBe('13')
    expect(editor.state.ready).toBe(true)
  })
})

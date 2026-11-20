import { describe, expect, it, vi } from 'vitest'
import { createMenuEditor, type MenuTarget } from './menuAssignment'
import type { MenuTreeNode } from '@/api/system/menu'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** applyChecked 记录树实况；readChecked 返回最近一次落树结果，模拟 check-strictly 精确集 */
function fixture() {
  let tree: string[] = []
  const deps = {
    loadIds: vi.fn(async (_id: string): Promise<string[]> => ['1', '2']),
    loadTree: vi.fn(async () => ['1', '2', '3', '4', '5', '9'].map((id) => ({ id, children: [] } as unknown as MenuTreeNode))),
    prepareTree: vi.fn(async (ids: string[], current: () => boolean) => { if (current()) deps.applyChecked(ids) }),
    applyChecked: vi.fn((ids: string[]) => { tree = [...ids] }),
    readChecked: vi.fn(() => [...tree]),
    confirmEmpty: vi.fn(async (_target: MenuTarget) => true),
    save: vi.fn(async (_id: string, _ids: string[]) => {}),
    success: vi.fn(),
  }
  return { deps, editor: createMenuEditor(deps), tree: () => tree }
}
const role = (id: string, name = `角色${id}`): MenuTarget => ({ id, name })

describe('分配菜单守卫：迟到响应与世代', () => {
  it('关闭后重开同一角色，旧读取不得覆盖新快照', async () => {
    const { editor, deps, tree } = fixture()
    const old = deferred<string[]>()
    deps.loadIds.mockReturnValueOnce(old.promise)
    const openingOld = editor.open(role('A'))
    editor.close()
    deps.loadIds.mockResolvedValueOnce(['9'])
    await editor.open(role('A'))
    old.resolve(['1', '2'])
    await openingOld
    expect(tree()).toEqual(['9'])
    expect(editor.state.ready).toBe(true)
  })

  it('同角色旧保存完成时，新弹窗未提交也不能被关闭或提示成功', async () => {
    const { editor, deps } = fixture()
    await editor.open(role('A'))
    const old = deferred<void>()
    deps.save.mockReturnValueOnce(old.promise)
    const savingOld = editor.submit()
    editor.close()
    await editor.open(role('A'))
    old.resolve()
    await savingOld
    expect(editor.state.visible).toBe(true)
    expect(editor.state.ready).toBe(true)
    expect(deps.success).not.toHaveBeenCalled()
  })

  it('同角色旧空集确认通过后，不得发出过期写入', async () => {
    const { editor, deps } = fixture()
    await editor.open(role('A'))
    deps.applyChecked([])
    const old = deferred<boolean>()
    deps.confirmEmpty.mockReturnValueOnce(old.promise)
    const confirmingOld = editor.submit()
    editor.close()
    await editor.open(role('A'))
    old.resolve(true)
    await confirmingOld
    expect(deps.save).not.toHaveBeenCalled()
    expect(editor.state.visible).toBe(true)
  })

  it('关闭后到达的旧读取不得覆盖新角色勾选', async () => {
    const { editor, deps, tree } = fixture()
    const slow = deferred<string[]>()
    deps.loadIds.mockReturnValueOnce(slow.promise)
    const openingA = editor.open(role('A'))
    editor.close()
    deps.loadIds.mockResolvedValueOnce(['9'])
    await editor.open(role('B'))
    expect(tree()).toEqual(['9'])
    slow.resolve(['1', '2'])
    await openingA
    expect(tree()).toEqual(['9'])
    expect(editor.state.target?.id).toBe('B')
  })

  it('保存中重开另一角色并再次保存，旧请求完成不得复位新保存态', async () => {
    const { editor, deps } = fixture()
    await editor.open(role('A'))
    const savingA = deferred<void>()
    deps.save.mockReturnValueOnce(savingA.promise)
    const submittingA = editor.submit()
    await Promise.resolve()
    expect(editor.state.saving).toBe(true)

    editor.close()
    await editor.open(role('B'))
    const savingB = deferred<void>()
    deps.save.mockReturnValueOnce(savingB.promise)
    const submittingB = editor.submit()
    await Promise.resolve()
    expect(editor.state.saving).toBe(true)

    savingA.resolve()
    await submittingA
    // A 的 finally 属于旧世代：不得复位 B 的保存态，也不得改 B 的目标/可见性
    expect(editor.state.saving).toBe(true)
    expect(editor.state.visible).toBe(true)
    expect(editor.state.target?.id).toBe('B')

    savingB.resolve()
    await submittingB
    expect(deps.save).toHaveBeenLastCalledWith('B', ['1', '2'], ['1', '2'])
    expect(editor.state.visible).toBe(false)
  })
})

describe('分配菜单守卫：读取与失败路径', () => {
  it('菜单ID先返回但树未完成时不可保存，双读取和回填后才就绪', async () => {
    const { editor, deps } = fixture()
    const tree = deferred<MenuTreeNode[]>()
    deps.loadTree.mockReturnValueOnce(tree.promise)
    const opening = editor.open(role('A'))
    await Promise.resolve()
    await Promise.resolve()
    expect(editor.editable()).toBe(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    tree.resolve(await fixture().deps.loadTree())
    await opening
    expect(editor.editable()).toBe(true)
  })

  it('树读取失败不能当成空集保存，重试完整读取后恢复', async () => {
    const { editor, deps } = fixture()
    deps.loadTree.mockRejectedValueOnce(new Error('树读取失败'))
    await editor.open(role('A'))
    expect(editor.editable()).toBe(false)
    expect(editor.state.error).toContain('树读取失败')
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    await editor.retry()
    expect(editor.editable()).toBe(true)
  })

  it('树尚未挂载或已有ID未完整回填时均拒绝保存', async () => {
    const { editor, deps } = fixture()
    deps.prepareTree.mockRejectedValueOnce(new Error('树尚未就绪'))
    await editor.open(role('A'))
    expect(editor.editable()).toBe(false)
    deps.prepareTree.mockImplementationOnce(async () => { deps.applyChecked(['1']) })
    await editor.retry()
    expect(editor.editable()).toBe(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('角色已绑菜单不在成功读取的树中时拒绝整体覆盖', async () => {
    const { editor, deps } = fixture()
    deps.loadIds.mockResolvedValueOnce(['9007199254740993'])
    await editor.open(role('A'))
    expect(editor.editable()).toBe(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('打开即清空、读取期间不可保存', async () => {
    const { editor, deps, tree } = fixture()
    await editor.open(role('A'))
    expect(tree()).toEqual(['1', '2'])
    const slow = deferred<string[]>()
    deps.loadIds.mockReturnValueOnce(slow.promise)
    const opening = editor.open(role('B'))
    expect(tree()).toEqual([])
    expect(editor.state.loading).toBe(true)
    expect(editor.editable()).toBe(false)
    slow.resolve(['3'])
    await opening
    expect(tree()).toEqual(['3'])
  })

  it('读取失败清空旧勾选且不可保存，重试后可保存', async () => {
    const { editor, deps, tree } = fixture()
    await editor.open(role('A'))
    deps.loadIds.mockRejectedValueOnce(new Error('读取失败'))
    await editor.open(role('B'))
    expect(editor.state.ready).toBe(false)
    expect(editor.state.error).toContain('读取失败')
    expect(tree()).toEqual([])
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    deps.loadIds.mockResolvedValueOnce(['4', '5'])
    await editor.retry()
    expect(editor.state.ready).toBe(true)
    await editor.submit()
    expect(deps.save).toHaveBeenCalledWith('B', ['4', '5'], ['4', '5'])
  })
})

describe('分配菜单守卫：空集确认与保存结果', () => {
  it('空集确认取消则不发请求且保持打开', async () => {
    const { editor, deps } = fixture()
    await editor.open(role('A'))
    deps.applyChecked([])
    deps.confirmEmpty.mockResolvedValueOnce(false)
    await editor.submit()
    expect(deps.save).not.toHaveBeenCalled()
    expect(editor.state.visible).toBe(true)
    expect(editor.state.saving).toBe(false)
  })

  it('空集确认通过发送空数组并关闭', async () => {
    const { editor, deps } = fixture()
    await editor.open(role('A'))
    deps.applyChecked([])
    await editor.submit()
    expect(deps.save).toHaveBeenCalledWith('A', [], ['1', '2'])
    expect(editor.state.visible).toBe(false)
    expect(deps.success).toHaveBeenCalledWith(role('A'))
  })

  it('保存失败保留弹窗与勾选，错误可见且可再次提交', async () => {
    const { editor, deps, tree } = fixture()
    await editor.open(role('A'))
    deps.save.mockRejectedValueOnce(new Error('保存失败'))
    await editor.submit()
    expect(editor.state.error).toContain('保存失败')
    expect(editor.state.visible).toBe(true)
    expect(editor.state.saving).toBe(false)
    expect(tree()).toEqual(['1', '2'])
    await editor.submit()
    expect(deps.save).toHaveBeenLastCalledWith('A', ['1', '2'], ['1', '2'])
  })
})

 it('提交携原菜单集合；409 保留草稿，重新读取前不可重试保存', async () => {
  const { editor, deps, tree } = fixture()
  await editor.open(role('A')); deps.applyChecked(['3'])
  deps.save.mockRejectedValueOnce({ response: { status: 409, data: { message: '集合已变化' } } })
  await editor.submit()
  expect(deps.save).toHaveBeenCalledWith('A', ['3'], ['1', '2'])
  expect(tree()).toEqual(['3']); expect(editor.state.visible).toBe(true)
  expect(editor.state.error).toContain('重新读取'); expect(editor.editable()).toBe(false)
  await editor.submit(); expect(deps.save).toHaveBeenCalledTimes(1)
  deps.loadIds.mockResolvedValueOnce(['4']); await editor.retry(); await editor.submit()
  expect(deps.save).toHaveBeenLastCalledWith('A', ['4'], ['4'])
 })

/**
 * 分配菜单弹窗的世代守卫（与 user 页 assignmentEditors 同构，仅服务 check-strictly 树）
 *
 * 三道隔离缺一不可：
 * - generation：每次打开/关闭作废旧读取，迟到响应不得覆盖当前角色的勾选集；
 * - operation 令牌：保存中的二次关闭/重开不得让旧 finally 关掉新弹窗的保存态；
 * - snapshot 门槛：只有「当前世代 + 当前角色」成功读完的草稿才允许提交，
 *   读取失败或未就绪时保存按钮不可用（editable=false）。
 *
 * 树的读写经 deps 注入：打开/关闭先清旧勾选，双读取成功后由prepareTree等待真实渲染，
 * 再核readChecked完整集合；失败不得把未就绪的空树解释为可提交草稿。
 */
import { reactive } from 'vue'
import { apiErrorBody } from '@/utils/apiError'
import { assignmentIds } from '@/api/system/assignmentPayload'
import type { MenuTreeNode } from '@/api/system/menu'

export interface MenuTarget { id: string; name: string }

interface MenuEditorDeps {
  /** 两路读取均成功，且真实树回填已核验后才能生成可提交快照。 */
  loadIds: (id: string) => Promise<string[]>
  loadTree: () => Promise<MenuTreeNode[]>
  prepareTree: (ids: string[], current: () => boolean) => Promise<void>
  /** 把勾选集写入树；关闭与失败路径传空集清洗残留 */
  applyChecked: (ids: string[]) => void
  /** 读取用户当前勾选（保存时以树实况为准，避免联动后草稿漏同步） */
  readChecked: () => Array<string | number>
  /** 空集=清空全部菜单，二次确认；返回 false 表示取消保存 */
  confirmEmpty: (target: MenuTarget) => Promise<boolean>
  save: (id: string, ids: string[], originalIds: string[]) => Promise<void>
  success: (target: MenuTarget) => void
}

export function createMenuEditor(deps: MenuEditorDeps) {
  const state = reactive({
    visible: false,
    target: null as MenuTarget | null,
    loading: false,
    ready: false,
    saving: false,
    error: '',
  })
  let generation = 0
  let operation = 0
  let snapshot: { generation: number; id: string; available: Set<string>; original: string[] } | null = null

  const current = (seq: number, id: string) => state.visible && generation === seq && state.target?.id === id
  const editable = () => state.visible && state.ready && !state.loading && !state.saving
  const message = (err: unknown) => apiErrorBody(err).message ?? (err instanceof Error ? err.message : '操作失败，请重试')

  function reset() {
    Object.assign(state, { visible: false, target: null, loading: false, ready: false, saving: false, error: '' })
  }

  function close() {
    ++generation
    snapshot = null
    reset()
    deps.applyChecked([]) // 关闭即清，下次打开不继承上一个角色
  }

  async function open(target: MenuTarget) {
    const id = target.id
    const seq = ++generation
    snapshot = null
    Object.assign(state, { visible: true, target: { ...target }, loading: true, ready: false, saving: false, error: '' })
    deps.applyChecked([]) // 打开即清，防止读取慢时看到旧勾选
    try {
      const [rawIds, tree] = await Promise.all([deps.loadIds(id), deps.loadTree()])
      if (!current(seq, id)) return
      const ids = assignmentIds(rawIds)
      const available = new Set<string>()
      const walk = (nodes: MenuTreeNode[]) => nodes.forEach((node) => { available.add(node.id); walk(node.children ?? []) })
      walk(tree)
      if (ids.some((menuId) => !available.has(menuId))) throw new Error('已绑定菜单不在当前菜单树中，请重新读取或联系管理员核查')
      await deps.prepareTree(ids, () => current(seq, id))
      if (!current(seq, id)) return
      const checked = assignmentIds(deps.readChecked())
      if (checked.length !== ids.length || ids.some((menuId) => !checked.includes(menuId))) throw new Error('已有菜单未完整回填，请重新读取或联系管理员核查')
      snapshot = { generation: seq, id, available, original: [...ids] }
      state.ready = true
    } catch (err) {
      // 树已在 open 时清空，失败路径不会残留上一个角色的勾选
      if (current(seq, id)) state.error = message(err)
    } finally {
      if (current(seq, id)) state.loading = false
    }
  }

  async function retry() {
    if (state.target && !state.loading && !state.saving && !state.ready) await open({ ...state.target })
  }

  async function submit() {
    if (!editable() || !snapshot || snapshot.generation !== generation || snapshot.id !== state.target?.id) return
    const seq = generation
    const target = { ...state.target }
    const token = ++operation
    state.saving = true // 首个 await（含确认框）前取得锁
    state.error = ''
    const same = () => current(seq, target.id) && token === operation
    try {
      const keys = assignmentIds(deps.readChecked())
      if (keys.some((id) => !snapshot!.available.has(id))) throw new Error('所选菜单不在当前菜单树中，请重新读取或联系管理员核查')
      if (keys.length === 0 && !await deps.confirmEmpty(target)) return
      if (!same()) return
      await deps.save(target.id, keys.map(String), [...snapshot.original])
      if (same()) {
        deps.success(target)
        close()
      }
    } catch (err) {
      if (same()) {
        const response = (err as { response?: { status?: number } })?.response
        if (response?.status === 409) {
          state.ready = false
          state.error = '菜单集合已变化，草稿已保留；请重新读取后核对再提交'
        } else state.error = message(err)
      }
    } finally {
      if (same()) state.saving = false
    }
  }

  return { state, open, close, retry, submit, editable }
}

import { reactive } from 'vue'
import type { RoleRow } from '@/api/system/role'
import type { UserOrgRow } from '@/api/system/user'
import type { OrgTreeNode } from '@/api/system/org'
import { assignmentId, assignmentIds, assignmentRecord } from '@/api/system/assignmentPayload'
import { apiErrorBody } from '@/utils/apiError'

interface Target { id: string; username: string }
interface State<Draft> {
  visible: boolean
  target: Target | null
  draft: Draft | null
  loading: boolean
  ready: boolean
  saving: boolean
  error: string
}
interface EditorDeps<Draft, Payload> {
  hasPermission: () => boolean
  load: (id: string) => Promise<Draft>
  prepare?: (draft: Draft, current: () => boolean) => Promise<void>
  capture: (draft: Draft) => Payload
  confirm?: (target: Target, payload: Payload) => Promise<boolean>
  save: (id: string, payload: Payload) => Promise<void>
  success: (target: Target) => void
}

/** 仅供本页两个全量替换弹窗；每次打开/关闭作废读取、确认和保存的旧世代。 */
function createAssignmentEditor<Draft, Payload>(deps: EditorDeps<Draft, Payload>) {
  const state = reactive({ visible: false, target: null, draft: null, loading: false, ready: false, saving: false, error: '' }) as State<Draft>
  let generation = 0
  let operation = 0
  let snapshot: { generation: number; userId: string } | null = null
  const current = (seq: number, id: string) => state.visible && generation === seq && state.target?.id === id
  const editable = () => deps.hasPermission() && state.visible && state.ready && !state.loading && !state.saving
  const message = (err: unknown) => apiErrorBody(err).message ?? (err instanceof Error ? err.message : '操作失败，请重试；提交结果未知时先核查原结果')

  function close() {
    ++generation
    snapshot = null
    Object.assign(state, { visible: false, target: null, draft: null, loading: false, ready: false, saving: false, error: '' })
  }

  async function open(target: Target) {
    if (!deps.hasPermission()) return
    const id = assignmentId(target.id)
    const seq = ++generation
    snapshot = null
    Object.assign(state, { visible: true, target: { id, username: target.username }, draft: null, loading: true, ready: false, saving: false, error: '' })
    try {
      const draft = await deps.load(id)
      if (!current(seq, id)) return
      state.draft = draft
      await deps.prepare?.(draft, () => current(seq, id))
      if (!current(seq, id)) return
      snapshot = { generation: seq, userId: id }
      state.ready = true
    } catch (err) {
      if (current(seq, id)) state.error = message(err)
    } finally {
      if (current(seq, id)) state.loading = false
    }
  }

  async function retry() {
    if (state.target && !state.loading && !state.saving && !state.ready) await open({ ...state.target })
  }

  async function submit() {
    if (!editable() || !state.draft || !snapshot || snapshot.generation !== generation || snapshot.userId !== state.target?.id) return
    const seq = generation
    const target = { ...state.target }
    const token = ++operation
    state.saving = true // 首个await（包括确认框）前取得锁。
    state.error = ''
    const same = () => current(seq, target.id) && token === operation
    try {
      const payload = deps.capture(state.draft)
      if (deps.confirm && !await deps.confirm(target, payload)) return
      if (!same() || !deps.hasPermission()) return
      await deps.save(target.id, payload)
      if (same()) {
        deps.success(target)
        close()
      }
    } catch (err) {
      if (same()) state.error = message(err)
    } finally {
      if (same()) state.saving = false
    }
  }
  return { state, open, close, retry, submit, editable }
}

interface RolesDraft { selected: string[]; options: RoleRow[]; original: string[] }
export function createRolesEditor(deps: {
  loadIds: (id: string) => Promise<string[]>
  loadOptions: () => Promise<RoleRow[]>
  hasPermission: () => boolean
  save: (id: string, ids: string[]) => Promise<void>
  success: (target: Target) => void
}) {
  return createAssignmentEditor<RolesDraft, string[]>({
    ...deps,
    async load(id) {
      const [ids, options] = await Promise.all([deps.loadIds(id), deps.loadOptions()])
      const selected = assignmentIds(ids)
      if (selected.some((roleId) => !options.some((r) => r.id === roleId))) throw new Error('已绑定角色不在可用字典中，请重试或由受权管理员核查')
      return { selected, options, original: [...selected] }
    },
    capture(draft) {
      const selected = assignmentIds(draft.selected)
      for (const id of selected) {
        const option = draft.options.find((r) => r.id === id)
        if (!option || (option.status === 0 && !draft.original.includes(id))) throw new Error('不可新增停用或未知角色，请核查当前选择')
      }
      return [...selected]
    },
  })
}

export interface OrgsDraft { tree: OrgTreeNode[]; selected: string[]; primary: string }
interface OrgsPayload { ids: string[]; primary: string | null }
function readOrgTree(value: unknown): OrgTreeNode[] {
  const seen = new Set<string>()
  function read(nodes: unknown): OrgTreeNode[] {
    if (!Array.isArray(nodes)) throw new Error('组织树载荷不完整，请重试或由受权管理员核查')
    return nodes.map((value) => {
      const row = assignmentRecord(value)
      const id = assignmentId(row.id)
      if (seen.has(id) || typeof row.name !== 'string' || !row.name || typeof row.is_virtual !== 'boolean') throw new Error('组织树载荷不完整，请重试或由受权管理员核查')
      seen.add(id)
      return { ...row, id, ...(row.children === undefined ? {} : { children: read(row.children) }) } as unknown as OrgTreeNode
    })
  }
  return read(value)
}

export function createOrgsEditor(deps: {
  loadTree: () => Promise<OrgTreeNode[]>
  loadMemberships: (id: string) => Promise<UserOrgRow[]>
  prepareTree: (draft: OrgsDraft, current: () => boolean) => Promise<void>
  hasPermission: () => boolean
  confirm: (target: Target, payload: OrgsPayload) => Promise<boolean>
  save: (id: string, ids: string[], primary: string | null) => Promise<void>
  success: (target: Target) => void
}) {
  return createAssignmentEditor<OrgsDraft, OrgsPayload>({
    ...deps,
    async load(id) {
      const [rawTree, memberships] = await Promise.all([deps.loadTree(), deps.loadMemberships(id)])
      const tree = readOrgTree(rawTree)
      const available = new Set<string>()
      const walk = (nodes: OrgTreeNode[]) => nodes.forEach((n) => { available.add(n.id); walk(n.children ?? []) })
      walk(tree)
      const selected = assignmentIds(memberships.map((m) => m.org_id))
      if (selected.some((orgId) => !available.has(orgId))) throw new Error('已绑定组织不在可用组织树中，请重试或由受权管理员核查')
      return { tree, selected, primary: memberships.find((m) => m.is_primary)?.org_id ?? '' }
    },
    prepare: deps.prepareTree,
    capture(draft) {
      const ids = assignmentIds(draft.selected)
      const primary = draft.primary ? assignmentId(draft.primary) : null
      if (primary && !ids.includes(primary)) throw new Error('主组织须在已勾选组织内')
      const known = new Set<string>()
      const walk = (nodes: OrgTreeNode[]) => nodes.forEach((n) => { known.add(n.id); walk(n.children ?? []) })
      walk(draft.tree)
      if (ids.some((id) => !known.has(id))) throw new Error('所选组织不在可用组织树中，请重新核查')
      return { ids: [...ids], primary }
    },
    save: (id, payload) => deps.save(id, payload.ids, payload.primary),
  })
}

/**
 * system 域组织 API（P4-W3 组织管理面——admin 专属；「我的组织」自服务面下一批）
 *
 * ⚠ org 域 handler 无 swag 注解（P1-8 仅补 user/role/menu/audit）——请求模型暂手写并
 * 与 model/org_request.go 对齐注记；主仓补注解后切生成类型（同 profile GET 裸信封欠账）。
 * OrgTreeNode=model.Organization JSON 投影（树形 children）。
 */
import request from '@vea/request'

/** = CreateOrgRequest（org_request.go:43——code/name 必填 max 对齐 DB varchar） */
export interface CreateOrgInput {
  code: string
  name: string
  description?: string
  parent_id?: string
  /** true=虚拟组（须 vg_ 前缀+挂实体下，后端校验） */
  is_virtual?: boolean
  sort_order?: number
}

/** = UpdateOrgRequest（org_request.go:57——id+version 乐观锁必填；指针 patch 语义） */
export interface UpdateOrgInput {
  id: string
  version: number
  name: string
  description?: string
  status?: 0 | 1
  sort_order?: number
  /** BK-13：仅实体组可配；虚拟组传入即 400 */
  ticket_visibility?: 'entity_transparent_read' | 'project_isolated'
}

/** = MoveOrgRequest（org_request.go:76） */
export interface MoveOrgInput {
  id: string
  new_parent_id?: string
}

/** 组织树节点（= model.Organization 的 JSON 投影；version 供 update 乐观锁回传） */
export interface OrgTreeNode {
  id: string
  code: string
  name: string
  description: string
  parent_id: string | null
  path: string
  children?: OrgTreeNode[]
  is_virtual: boolean
  status: number
  is_system: boolean
  sort_order: number
  owner_user_ids: string[]
  ticket_visibility: string
  version: number
  created_at?: string
}

/** 全组织树（GET /orgs，管理面；config 可选——发起页兜底等 403 静默场景传 _silentError） */
export async function getOrgTreeApi(config?: { _silentError?: boolean }): Promise<OrgTreeNode[]> {
  const data = await request.get('/api/v1/orgs', config)
  return data as unknown as OrgTreeNode[]
}

export async function createOrgApi(input: CreateOrgInput): Promise<OrgTreeNode> {
  const data = await request.post('/api/v1/orgs', input, { _silentError: true })
  return data as unknown as OrgTreeNode
}

export async function updateOrgApi(input: UpdateOrgInput): Promise<void> {
  // 10006 乐观锁冲突由页面内联处理（与用户/角色页同范式）
  await request.post('/api/v1/orgs/update', input, { _silentError: true })
}

export async function moveOrgApi(input: MoveOrgInput): Promise<void> {
  await request.post('/api/v1/orgs/move', input, { _silentError: true })
}

/** 删除（OrgIDRequest——body 字段 org_id；委托版端点，管理面同路径复用） */
export async function deleteOrgApi(orgId: string): Promise<void> {
  await request.post('/api/v1/orgs/delete', { org_id: orgId }, { _silentError: true })
}

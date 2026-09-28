/**
 * system 域角色 API（P4-W3 角色管理页）
 *
 * 入参接 codegen 生成类型；出参手写行形状（裸信封，注明对齐 model.Role）。
 */
import request from '@vea/request'
import type { components } from '@/api/__generated__/schema'

type Schemas = components['schemas']

export type CreateRoleInput =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.CreateRoleRequest']
export type UpdateRoleInput =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.UpdateRoleRequest']

/** 角色行（= model.Role 的 JSON 投影；version 供 update 乐观锁回传） */
export interface RoleRow {
  id: string
  code: string
  name: string
  description: string
  status: number
  priority: number
  parent_id: string | null
  sort_order: number
  version: number
  created_at: string
}

/** 全量角色（GET /roles 无分页——管理台角色数量级小） */
export async function listRolesApi(): Promise<RoleRow[]> {
  const data = await request.get('/api/v1/roles')
  return data as unknown as RoleRow[]
}

export async function createRoleApi(input: CreateRoleInput): Promise<RoleRow> {
  const data = await request.post('/api/v1/roles', input, { _silentError: true })
  return data as unknown as RoleRow
}

export async function updateRoleApi(input: UpdateRoleInput): Promise<void> {
  // 10006 乐观锁冲突由页面内联处理（与用户页同范式）
  await request.post('/api/v1/roles/update', input, { _silentError: true })
}

export async function deleteRoleApi(roleId: string): Promise<void> {
  // RoleIDRequest 字段名=role_id（非 id——E2E 实证发 id 会 400 参数错误）
  await request.post('/api/v1/roles/delete', { role_id: roleId }, { _silentError: true })
}

/** 角色已绑菜单 ID 集（替换语义——AssignMenus 保存前的初始勾选） */
export async function getRoleMenuIdsApi(roleId: string): Promise<number[]> {
  const data = await request.get(`/api/v1/roles/${roleId}/menus`)
  return ((data as unknown as { menu_ids?: number[] })?.menu_ids ?? [])
}

/** 分配菜单（整体替换；check-strictly 精确勾选集直传） */
export async function assignRoleMenusApi(roleId: string, menuIds: number[]): Promise<void> {
  await request.post('/api/v1/roles/menus', { role_id: roleId, menu_ids: menuIds })
}

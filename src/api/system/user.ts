/**
 * system 域用户 API（P4-W3 用户管理页）
 *
 * 入参一律接 codegen 生成类型（AGENTS「api 层切 generated 类型」——契约漂移编译期报错）；
 * 出参侧 swag 为裸信封（data 无泛型），行形状手写并注明与后端 model.User 对齐，
 * 后端补 @Success 泛型后同法切换。
 */
import request from '@vea/request'
import type { components } from '@/api/__generated__/schema'

type Schemas = components['schemas']

export type CreateUserInput =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.CreateUserRequest']
export type UpdateUserInput =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.UpdateUserRequest']

/** 列表行（= model.User 的 JSON 投影；version 供 update 乐观锁回传） */
export interface UserRow {
  id: string
  username: string
  employee_no: string
  real_name: string
  email: string
  phone: string
  avatar: string
  status: number
  must_change_password: boolean
  version: number
  created_at: string
}

/** 搜索参数严格对齐端点（username 模糊/employee_no 精确/role 精确/status——无 org/real_name，不假搜索） */
export interface UserListQuery {
  username?: string
  employee_no?: string
  role?: string
  status?: number
}

export async function listUsersApi(
  params: { page: number; page_size: number } & UserListQuery,
): Promise<{ list: UserRow[]; total: number }> {
  const data = await request.get('/api/v1/users', { params })
  return data as unknown as { list: UserRow[]; total: number }
}

export async function createUserApi(input: CreateUserInput): Promise<void> {
  await request.post('/api/v1/users', input, { _silentError: true })
}

export async function updateUserApi(input: UpdateUserInput): Promise<void> {
  // 10006 乐观锁冲突由页面内联处理（重拉列表提示重试——01 §3.3 非 toast 路径）
  await request.post('/api/v1/users/update', input, { _silentError: true })
}

export async function updateUserStatusApi(userId: string, status: 0 | 1): Promise<void> {
  await request.post('/api/v1/users/status', { user_id: userId, status })
}

export async function resetUserPasswordApi(userId: string, password: string): Promise<void> {
  await request.post('/api/v1/users/password/reset', { user_id: userId, password }, { _silentError: true })
}

/** 角色分配（P3-6：ID 数组元素发送侧一律 string——standards §3-12②；Int64Slice 双兼容仅收方宽容） */
export async function setUserRolesApi(userId: string, roleIds: string[]): Promise<void> {
  await request.post('/api/v1/users/roles', { user_id: userId, role_ids: roleIds })
}

// ===== P2-12：分配组织（GET /users/:id/orgs + POST /users/orgs 全量替换） =====

/** 用户已绑组织行（= model.UserOrg 投影——无 org_name，名称由组织树侧供给） */
export interface UserOrgRow {
  user_id: string
  org_id: string
  is_primary: boolean
  joined_at: string
}

export async function getUserOrgsApi(userId: string): Promise<UserOrgRow[]> {
  const data = await request.get(`/api/v1/users/${userId}/orgs`, { _silentError: true })
  return ((data as unknown as { orgs?: UserOrgRow[] })?.orgs ?? [])
}

/**
 * 用户已绑角色 ID 集（P2-5 新端点 GET /users/:id/roles → {role_ids:[...]}——
 * 裸 number 数组出参（同 menu_ids 形态），消费侧勾选按 string 处理）。
 * 替代「工号精确+角色过滤」N+1 反查（旧法每角色一次请求且无工号用户不可回显）。
 */
export async function getUserRoleIdsApi(userId: string): Promise<string[]> {
  const data = await request.get(`/api/v1/users/${userId}/roles`, { _silentError: true })
  return ((data as unknown as { role_ids?: number[] })?.role_ids ?? []).map(String)
}

/** 全量设置用户组织（org_ids 整体替换；primary_org_id 可选——须 ∈ org_ids） */
export async function setUserOrgsApi(userId: string, orgIds: string[], primaryOrgId?: string | null): Promise<void> {
  await request.post('/api/v1/users/orgs', {
    user_id: userId,
    org_ids: orgIds,
    ...(primaryOrgId ? { primary_org_id: primaryOrgId } : {}),
  }, { _silentError: true })
}

export async function deleteUserApi(userId: string): Promise<void> {
  await request.post('/api/v1/users/delete', { user_id: userId })
}

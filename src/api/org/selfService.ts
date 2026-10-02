/**
 * 「我的组织」自服务 API（P4-W3 收口件——非 admin 委托者唯一可达入口，02 §2-W3）
 *
 * 全部端点为 SelfService（跳 Casbin）：数据源 GET /user/orgs；名册/成员操作走委托端点
 * （L3 判定在 Service 层——前端以名册 403 降级为只读视图）。
 * 入参出参接 codegen 生成类型（MyOrg/Roster/委托请求模型均已进 definitions）。
 */
import request from '@vea/request'
import type { components } from '@/api/__generated__/schema'

type Schemas = components['schemas']

export type MyOrgItem = Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.MyOrgItem']
export type OrgMemberRosterResponse =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.OrgMemberRosterResponse']
export type OrgMemberRosterItem =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.OrgMemberRosterItem']
export type SetOrgMemberRoleInput =
  Schemas['github_com_tracerbiubiubiu_zhuzhao_internal_model.SetOrgMemberRoleRequest']
/** = SetMemberScopeRequest（org_request.go:22——该 handler 无 swag 注解，暂手写对齐） */
export interface SetMemberScopeInput {
  org_id: string
  user_id: string
  ticket_scope: 'assigned' | 'group' | 'all'
}

/** 我的组织列表（SelfService 数据源） */
export async function getMyOrgsApi(): Promise<MyOrgItem[]> {
  const data = await request.get('/api/v1/user/orgs')
  return ((data as unknown as { list?: MyOrgItem[] })?.list ?? [])
}

/**
 * 委托组成员名册（L3：owner/admin/全局可读）。普通成员 403——调用方据此降级只读视图。
 */
export async function getOrgRosterApi(
  orgId: string,
  page = 1,
  pageSize = 50,
): Promise<OrgMemberRosterResponse> {
  const data = await request.get('/api/v1/orgs/members/list', {
    params: { org_id: orgId, page, page_size: pageSize },
    // 403（普通成员）不是错误场景而是可见性判定——静默，由页面分流
    _silentError: true,
  })
  return data as unknown as OrgMemberRosterResponse
}

/** 组内角色变更（owner/admin 可用；owner 角色仅经 SetOwners——此处 member↔admin） */
export async function setMemberRoleApi(input: SetOrgMemberRoleInput): Promise<void> {
  await request.post('/api/v1/orgs/members/role', input, { _silentError: true })
}

/** 成员数据范围变更（owner/admin；scope=all 仅全局管理员可授） */
export async function setMemberScopeApi(input: SetMemberScopeInput): Promise<void> {
  await request.post('/api/v1/orgs/members/scope', input, { _silentError: true })
}

/** 移除成员（owner/admin；不可移除现有 owner） */
export async function removeMemberApi(orgId: string, userId: string): Promise<void> {
  await request.post('/api/v1/orgs/members/delete', { org_id: orgId, user_id: userId }, { _silentError: true })
}

/**
 * 设置组织负责人（P2-11：POST /orgs/owners——owner_user_ids **整体替换**，L3 owner/全局判定）。
 * ⚠ 调用方须先取全量 owner 集（名册端点 pageSize 硬顶 100——超员组织需后端补 owners
 * 读端点后再放开，见视图注记）。
 */
export async function setOwnersApi(orgId: string, ownerUserIds: string[]): Promise<void> {
  await request.post('/api/v1/orgs/owners', { org_id: orgId, owner_user_ids: ownerUserIds }, { _silentError: true })
}

/**
 * system 域角色 API（P4-W3——用户页搜索下拉/分配角色消费；角色管理页本批未建）
 */
import request from '@vea/request'

/** 角色行（= model.Role 的 JSON 投影；id string——int64 序列化公约） */
export interface RoleRow {
  id: string
  code: string
  name: string
  description: string
  status: number
  priority: number
}

/** 全量角色（GET /roles 无分页——管理台角色数量级小） */
export async function listRolesApi(): Promise<RoleRow[]> {
  const data = await request.get('/api/v1/roles')
  return data as unknown as RoleRow[]
}

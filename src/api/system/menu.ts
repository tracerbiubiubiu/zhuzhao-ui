/**
 * system 域菜单 API（P4-W3 角色页分配菜单勾选树数据源；菜单管理页=W3 第四批只读树）
 */
import request from '@vea/request'
import { assignmentId, assignmentRecord } from './assignmentPayload'

/**
 * 菜单树节点（= model.Menu 的 JSON 投影；children 由后端组树，含按钮节点 menu_type=3）。
 * 当前菜单与parent_id均为精确十进制字符串；接收侧只兼容安全整数，不转换大ID为Number。
 */
export interface MenuTreeNode {
  id: string
  parent_id: string | null
  code: string
  name: string
  menu_type: number // 1=目录 2=页面 3=按钮
  permission: string
  path: string
  component: string
  icon: string
  sort_order: number
  visible: boolean
  children?: MenuTreeNode[]
}

/** 全量菜单树（GET /menus，管理面——含按钮节点） */
export async function getMenuTreeApi(): Promise<MenuTreeNode[]> {
  const data = await request.get('/api/v1/menus')
  const seen = new Set<string>()
  function read(value: unknown): MenuTreeNode[] {
    if (!Array.isArray(value)) throw new Error('菜单树读取不完整，请重新读取或联系管理员核查')
    return value.map((value) => {
      const row = assignmentRecord(value)
      const id = assignmentId(row.id)
      if (seen.has(id) || typeof row.name !== 'string' || !row.name || ![1, 2, 3].includes(row.menu_type as number)) throw new Error('菜单树读取不完整，请重新读取或联系管理员核查')
      seen.add(id)
      const parent_id = row.parent_id == null ? null : assignmentId(row.parent_id)
      return { ...row, id, parent_id, ...(row.children === undefined ? {} : { children: read(row.children) }) } as unknown as MenuTreeNode
    })
  }
  return read(data)
}

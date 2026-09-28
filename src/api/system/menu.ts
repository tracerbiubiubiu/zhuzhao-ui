/**
 * system 域菜单 API（P4-W3 角色页分配菜单勾选树数据源；菜单管理页=W3 第四批只读树）
 */
import request from '@vea/request'

/**
 * 菜单树节点（= model.Menu 的 JSON 投影；children 由后端组树，含按钮节点 menu_type=3）。
 * ⚠ 实测 wire 实况：menus 域 id 为 **number**（与 users/roles 的 string 形态不同——
 * 后端 model tag 差异；以运行时为准，node-key/getCheckedKeys 均按 number 处理）。
 */
export interface MenuTreeNode {
  id: number
  parent_id: number | null
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
  return data as unknown as MenuTreeNode[]
}

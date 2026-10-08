/**
 * dirCascadeKeys 单测——AssignMenus 目录级联动的纯逻辑。
 * 核心回归面：页面/按钮独立性（B 案硬要求）不得被联动破坏；目录勾/消对称连带子孙。
 */
import { describe, expect, it } from 'vitest'
import type { MenuTreeNode } from '@/api/system/menu'
import { dirCascadeKeys } from './menuTreeCascade'

/** 测试树：系统管理(1,目录) → 用户管理(11,页面) → [新建用户(111)/删除用户(112) 按钮]、角色管理(12,页面)；工单(2,目录) → 工单列表(21,页面) */
function node(partial: Partial<MenuTreeNode> & Pick<MenuTreeNode, 'id' | 'menu_type'>): MenuTreeNode {
  return {
    parent_id: null, code: '', name: '', permission: '', path: '', component: '',
    icon: '', sort_order: 0, visible: true, ...partial,
  }
}
const tree: MenuTreeNode[] = [
  node({
    id: 1, menu_type: 1, name: '系统管理',
    children: [
      node({
        id: 11, menu_type: 2, name: '用户管理',
        children: [node({ id: 111, menu_type: 3, name: '新建用户' }), node({ id: 112, menu_type: 3, name: '删除用户' })],
      }),
      node({ id: 12, menu_type: 2, name: '角色管理' }),
    ],
  }),
  node({ id: 2, menu_type: 1, name: '工单', children: [node({ id: 21, menu_type: 2, name: '工单列表' })] }),
]

describe('dirCascadeKeys', () => {
  it('勾选目录 → 全部子孙并入勾选集（目录+页面+按钮）', () => {
    const next = dirCascadeKeys(tree, 1, [1])
    expect(next).toEqual([1, 11, 111, 112, 12])
  })

  it('取消目录 → 子孙全部移出，兄弟目录的勾选不受影响', () => {
    // 取消勾选事件里 checkedKeys 已不含被取消的目录 id（el-tree 先更新后上报）
    const next = dirCascadeKeys(tree, 1, [11, 111, 112, 12, 2, 21])
    expect(next).toEqual([2, 21])
  })

  it('勾选页面 → 返回 null（页面/按钮独立性——B 案只读授权硬要求）', () => {
    expect(dirCascadeKeys(tree, 11, [11])).toBeNull()
  })

  it('勾选按钮 → 返回 null', () => {
    expect(dirCascadeKeys(tree, 111, [111])).toBeNull()
  })

  it('目录下已有部分勾选时再勾目录 → 并集去重、兄弟分支保留', () => {
    const next = dirCascadeKeys(tree, 1, [11, 2, 21, 1])
    expect(next?.map(String).sort()).toEqual(['1', '11', '111', '112', '12', '2', '21'])
    expect(new Set(next).size).toBe(next!.length)
  })

  it('取消目录连带取消此前显式勾选的子孙（对称语义：整个模块撤掉）', () => {
    // 11 先被联动勾上，随后取消目录 1（事件时 checkedKeys=[11]，已不含 1）→ 11 一并移出
    const next = dirCascadeKeys(tree, 1, [11])
    expect(next).toEqual([])
  })

  it('多级目录递归联动（孙子层按钮一并带上）', () => {
    const deep: MenuTreeNode[] = [
      node({
        id: 9, menu_type: 1, name: '深层',
        children: [node({ id: 91, menu_type: 1, name: '子目录', children: [node({ id: 911, menu_type: 3, name: '按钮' })] })],
      }),
    ]
    expect(dirCascadeKeys(deep, 9, [9])).toEqual([9, 91, 911])
  })
})

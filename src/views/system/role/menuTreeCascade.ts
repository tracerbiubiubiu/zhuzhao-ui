/**
 * AssignMenus 勾选树的目录级联动（纯函数，便于单测；组件侧仅做 @check 接线）
 *
 * 背景：B 案词表拆分下 el-tree 必须 check-strictly=true（页面≠自动含其按钮，只读授权
 * 前提），代价是勾目录不联动子级。本模块在其上加应用层批量糖：**目录（menu_type=1）
 * 勾选/取消均连带其全部子孙**——目录只是归类容器、无授权语义；页面/按钮节点保持完全
 * 独立（硬要求不变），回显与保存仍取精确勾选集，往返零漂移。
 */
import type { MenuTreeNode } from '@/api/system/menu'

/**
 * 计算目录勾选联动后的勾选集。
 * @param tree        菜单树（= getMenuTreeApi 返回）
 * @param toggledId   本次点击的节点 id（el-tree @check 首参 data.id）
 * @param checkedKeys 点击后树报告的勾选键（check-strictly 下即精确勾选集）
 * @returns 联动后的勾选键；点的是页面/按钮节点（保持独立）返回 null 表示无需重设
 */
export function dirCascadeKeys(
  tree: MenuTreeNode[],
  toggledId: string | number,
  checkedKeys: Array<string | number>,
): Array<string | number> | null {
  const find = (nodes: MenuTreeNode[]): MenuTreeNode | undefined => {
    for (const n of nodes) {
      if (String(n.id) === String(toggledId)) return n
      const hit = n.children ? find(n.children) : undefined
      if (hit) return hit
    }
    return undefined
  }
  const target = find(tree)
  if (!target || target.menu_type !== 1) return null

  const subtreeIds: Array<string | number> = []
  const subtree = new Set<string>()
  const collect = (n: MenuTreeNode) => {
    subtreeIds.push(n.id)
    subtree.add(String(n.id))
    n.children?.forEach(collect)
  }
  collect(target)

  const rest = checkedKeys.filter((k) => !subtree.has(String(k)))
  const toggledOn = checkedKeys.some((k) => String(k) === String(target.id))
  return toggledOn ? [...rest, ...subtreeIds] : rest
}

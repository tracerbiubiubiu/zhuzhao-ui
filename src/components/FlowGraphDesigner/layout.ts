/**
 * 自动布局（S2 B2-2——02 号附录 A.2「重开无缓存时自动布局」）。
 *
 * 分层 BFS：以起始态 open（缺省取首状态）为根逐层向右铺列，同层自上而下；不可达状态按
 * states 顺序作为新根续接在最后一列之后。确定性（同输入同输出），无随机量。
 *
 * 自写而非引 dagre（~100 KB+）：状态图量级 ≤ 十余节点，分层 BFS 三十行足够；坐标是本地视图
 * 偏好不入库（A.2），布局质量只需"可读"而非"最优"。
 */
import { START_STATE, type Adjacency, type Positions } from './types'

export interface LayoutOptions {
  /** 首列中心 x */
  x0?: number
  /** 首行中心 y */
  y0?: number
  /** 列距 */
  dx?: number
  /** 行距 */
  dy?: number
}

export function autoLayout(states: readonly string[], transitions: Adjacency, opts: LayoutOptions = {}): Positions {
  const { x0 = 120, y0 = 70, dx = 210, dy = 90 } = opts
  const set = new Set(states)
  const visited = new Set<string>()
  const levels: string[][] = []

  const bfs = (root: string) => {
    if (visited.has(root)) return
    let frontier = [root]
    visited.add(root)
    let depth = levels.length
    while (frontier.length) {
      // 续接根：第一层落在已有最大列之后，保持列单调不回填
      ;(levels[depth] ??= []).push(...frontier)
      const next: string[] = []
      for (const s of frontier) {
        for (const to of transitions[s] ?? []) {
          if (!set.has(to) || visited.has(to)) continue
          visited.add(to)
          next.push(to)
        }
      }
      frontier = next
      depth++
    }
  }

  if (set.has(START_STATE)) bfs(START_STATE)
  for (const s of states) bfs(s)

  const pos: Positions = {}
  levels.forEach((col, li) => {
    col.forEach((s, ri) => {
      pos[s] = { x: x0 + li * dx, y: y0 + ri * dy }
    })
  })
  return pos
}

/**
 * 分页覆盖哨兵（2026-10-29 分页复查批立——「同样的问题不要出现多次」）：
 * 全仓含 <el-table 的页面必须具备分页设施之一（ProTable / el-pagination /
 * nextCursor 客户端翻页 / 面板分页 ref），或显式登记豁免（真·固定小量级——
 * 树视图/固定键位/附属面板）。静态门禁对此零捕获：分页缺失是数据增长后才
 * 显形的缺口（al/types 241 行 / ticket/type 51 / 模板 84 三例同类），
 * 本用例为结构级自动拦截层（与 epImports/tableFitScan 同型）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(fileURLToPath(import.meta.url), '..')

function walkVue(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__generated__') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walkVue(p))
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

// 豁免登记（增量必须附理由——「持续累积增长」的数据面禁入豁免，那是三例事故的根因形态；
// 登记口径=设计量级 + 增长触发条件，超限即移出豁免改真分页）
const EXEMPT = new Set([
  // 树视图（全量语义，非增长型列表）
  'views/system/menu/index.vue',
  'views/system/org/index.vue',
  // 固定键位/附属小面板
  'views/system/setting/index.vue', // 五键固定配置（零增长）
  'views/Home/index.vue', // 最近工单固定 10 条（端点截断，非全量）
  'views/Profile/index.vue', // PAT 表——个人令牌个位数（触发：支持多令牌放量后移出）
  'views/ticket/rules/index.vue', // 分派规则——管理员手建个位数（触发：>30 条改真分页）
  // 客户端小量全量（豁免口径已在页头注释登记）
  'views/system/dict/index.vue', // 字典类型/项——设计小量级（page_size=100 假设已页头注释；触发：字典类型 >50 移出）
  // 对话框/抽屉内表（定宽附属视图）
  'views/ticket/detail/index.vue',
  'views/ticket/create/index.vue',
  'views/task/list/index.vue', // 主体 ProTable 已分页；余为对话框内表
])

describe('分页覆盖哨兵（防超阈值全量渲染再犯）', () => {
  it('全仓含 <el-table 的页面均具备分页设施（或登记豁免）', () => {
    const hosts = walkVue(ROOT).filter((f) => {
      const rel = f.slice(ROOT.length + 1)
      if (EXEMPT.has(rel)) return false
      const src = readFileSync(f, 'utf-8').replace(/<!--[\s\S]*?-->/g, '')
      return /<el-table[\s>]/.test(src)
    })
    expect(hosts.length, '受检宿主文件数').toBeGreaterThanOrEqual(8)

    const violations: string[] = []
    for (const f of hosts) {
      if (f.endsWith(join('components', 'ProTable', 'index.vue'))) continue
      const src = readFileSync(f, 'utf-8')
      const hasPager = /el-pagination|ProTable|nextCursor|next_cursor/.test(src)
      if (!hasPager) violations.push(`${f}: 含 <el-table> 但无任何分页设施（ProTable/el-pagination/cursor）——会增长的数据面禁用全量渲染，见 frontend-standard 分页统一约定`)
    }

    expect(violations.join('\n'), '分页缺失（frontend-standard「全量内滚 ≤50 行且不增长」豁免外的表必须分页）').toBe('')
  })
})

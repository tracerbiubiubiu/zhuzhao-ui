/**
 * UI 惯例哨兵矩阵（2026-10-29 立——「同样的问题不要出现多次」纪律的结构化落地）
 *
 * 两个静态扫描（与 epImports / tableFitScan 同型的自动捕获层——分页缺失类缺陷
 * 静态门禁零捕获、数据增长后才显形，al/types 241 行 / ticket/type 51 / 模板 84
 * 三例同型事故的拦截层）：
 *
 * ① 空态引导覆盖：主列表页 <el-table> 必须挂 #empty 槽（空态引导三件——行动
 *    出口 CTA/指引文案），默认「暂无数据」裸空态违反 frontend-standard §空态与加载。
 * ② placeholder 长度：静态串 >14 可见字符 → 高概率被控件宽度截断显示不全
 *    （审计工号「如 E000001（含已删用户）」17 字符挤 176px 实测；规范 §筛选 v2
 *    控件细节③——≤8 中文字符，附注挪 title）。动态表达式（${}）豁免——
 *    运行时形态静态不可判。
 *
 * 新增哨兵的纪律：只收「静态可判 + 零误报 + 有事故出处」的规则——语义类
 * （按钮命名/文案语气）不进哨兵，走 code review。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(fileURLToPath(import.meta.url), '..', '..'))

/** 递归收集 .vue 文件（去 dist/node_modules） */
function walkVue(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkVue(p))
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

const rel = (f: string) => f.slice(ROOT.length + 1)

/** 去 HTML 注释（注释里的示例标签不算宿主/不算违规） */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

/** 主列表页豁免（①空态扫描）：非主列表语义/有页级兜底的宿主，登记须附理由 */
const EMPTY_SCAN_EXEMPT = new Set([
  // 页级/组件级空态承载（表格槽外另有整页 el-empty 引导）
  'src/views/Home/index.vue', // 最近工单——空态由整页 el-empty 承载（非表格槽）
  'src/views/al/data/index.vue', // 数据区——类型未选/无数据由整页 el-empty+「写入首条」承载
  'src/views/Profile/index.vue', // PAT 表——空态由生成入口承载
  // 系统自动落库数据（非用户创建面——空态无「行动出口」语义，EP 默认暂无数据合理）
  'src/views/audit/log/index.vue', // 审计流水（ProTable 内置空态）
  'src/views/task/list/index.vue', // 任务运行（ProTable 内置空态）；余为对话框内表
  // 表单页（无列表语义）
  'views/ChangePassword/index.vue',
  'src/views/ticket/create/index.vue',
  'src/views/ticket/detail/index.vue', // 详情页评论/附件表有各自空态文案
  // 固定键位/树视图（永不空或非列表语义）
  'src/views/system/setting/index.vue', // 五键固定配置
  'src/views/system/org/index.vue',
  'src/views/system/menu/index.vue',
  // 对话框/抽屉内表（定宽附属视图，宿主页空态已覆盖）
  'src/views/ticket/type/index.vue', // 字段配置器 860px 定宽表（tableFitScan 豁免同源）
])

/** ② placeholder 扫描豁免（文件级）：动态表达式/规范允许的样例式 */
// 无文件级豁免——逐条按长度判（>14 可见字符违规）

describe('UI 惯例哨兵矩阵', () => {
  it('① 主列表页 el-table 均挂 #empty 空态引导槽', () => {
    const hosts = walkVue(join(ROOT, 'src', 'views')).map(rel).filter((r) => !EMPTY_SCAN_EXEMPT.has(r))
    expect(hosts.length, '受检主列表页数').toBeGreaterThanOrEqual(10)

    const violations: string[] = []
    for (const r of hosts) {
      const src = stripComments(readFileSync(join(ROOT, r), 'utf-8'))
      if (!/<el-table[\s>]/.test(src)) continue
      if (!/#empty/.test(src)) violations.push(`${r}: 含 <el-table> 未挂 #empty 空态引导（frontend-standard §空态与加载）`)
    }
    expect(violations.join('\n'), '主列表空态引导缺失').toBe('')
  })

  it('② placeholder 静态串 ≤14 可见字符（防控件宽度截断）', () => {
    const violations: string[] = []
    // 仅静态串：排除 :placeholder 动态绑定（${} 表达式运行时形态静态不可判）；
    // 宽度口径 = CJK 记 1 / ASCII 记 0.5（对齐终端显示宽），阈值 14（≈8 CJK 视觉
    // 密度上限的宽松版——本批实测台账，超限逐条精简或挪 title）
    const re = /(?<!:)(?<!\b:)placeholder="([^"{]+)"/g
    const visWidth = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.5), 0)
    for (const f of walkVue(join(ROOT, 'src', 'views'))) {
      const src = stripComments(readFileSync(f, 'utf-8'))
      for (const m of src.matchAll(re)) {
        const text = m[1]
        const w = visWidth(text)
        if (w > 14) {
          violations.push(`${rel(f)}: placeholder "${text}"（宽 ${w} > 14）——精简或挪 title`)
        }
      }
    }
    expect(violations.join('\n'), 'placeholder 超长（控件宽度内显示不全）').toBe('')
  })
})

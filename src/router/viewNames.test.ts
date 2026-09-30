/**
 * 视图组件名 ↔ 动态路由名 防漂移测试（keep-alive 契约）——期望名单**从主仓迁移种子派生**
 *
 * AppView 的 `<keep-alive :include="cachedViews">` 按**组件名**匹配，而 tagsView 存的是
 * **路由名**（= 菜单 code，顶层页面特例为 `${code}_page`）。视图全是 index.vue（推断名恒
 * "index"），必须 defineOptions 声明与路由名一致的组件名，否则 keep-alive 整体空转。
 *
 * 复检 P1-1/P3-8：原实现是写死名单——主仓新增菜单页后忘了在前端 defineOptions /
 * 忘了在本测试登记，都**静默漏检**。现改为解析 `migrations/*.up.sql` 的 menus
 * INSERT/UPDATE（与 DB 同序重放），派生「页面行 → 期望组件名 → 视图文件必须存在
 * 且声明一致」。新种子页落地即被测试覆盖，写死名单退场。
 *
 * 派生规则（= routerHelper.buildRoutes 的名字语义）：
 *  - 页面行 = menu_type=2，或 menu_type=1 且 component 非空（home 特例）
 *  - visible=false 的种子行跳过（000033 system_notification 预登记占位——无视图）
 *  - 全部 UPDATE 重放后 parent=NULL（顶层）→ `${code}_page`；嵌套 → `code`
 *  - component 串按大小写归一解析视图文件（种子 'home' → views/Home/index.vue，
 *    与 resolveViewComponent 同口径）
 * 另：常量路由实名（Profile/MyOrg/TicketCreate/TicketDetail）无种子可派生，保留静态段。
 */
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirnameOf(import.meta.url)
const REPO_ROOT = resolve(HERE, '../..')
const MIGRATIONS_DIR = resolve(REPO_ROOT, process.env.ZHUZHAO_REPO ?? '../zhuzhao', 'migrations')
const VIEWS_DIR = join(REPO_ROOT, 'src/views')

function dirnameOf(u: string): string {
  return join(fileURLToPath(u), '..')
}

/** ─── SQL 解析（只认种子里实际用到的三种语句形态）─── */

interface MenuRow {
  code: string
  parent: string | null
  menuType: number
  component: string
  visible: boolean
  from: string // 来源迁移文件（报错定位）
}

/** 按顶层逗号切分（括号/引号内不算） */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === "'") quote = false
      continue
    }
    if (ch === "'") {
      quote = true
      cur += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 提取 VALUES 体里的顶层元组（每元组 = 一行） */
function tuplesOf(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (depth === 0 && ch === '(') {
      depth = 1
      cur = ''
      continue
    }
    if (depth > 0) {
      if (ch === '(') depth++
      if (ch === ')') {
        depth--
        if (depth === 0) {
          out.push(cur)
          continue
        }
      }
      cur += ch
    }
  }
  return out
}

const unquote = (cell: string): string => cell.replace(/^'|'$/g, '')

/** parent 单元格：NULL → null；(SELECT id FROM menus WHERE code='x') → 'x' */
function parentOf(cell: string): string | null {
  if (!cell || /^NULL$/i.test(cell)) return null
  const m = cell.match(/\(SELECT id FROM menus WHERE code = '([^']+)'\)/i)
  return m ? m[1] : null
}

/** 重放全部 up.sql（按迁移号顺序、语句出现顺序），产出终态菜单行集 */
function deriveMenuRows(): MenuRow[] {
  if (!statSync(MIGRATIONS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`未找到主仓迁移目录 ${MIGRATIONS_DIR}——设 ZHUZHAO_REPO=<主仓路径>（同 codegen.sh 口径）`)
  }
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /\.up\.sql$/.test(f))
    .sort()
  const byCode = new Map<string, MenuRow>()
  const perFileActions = new Map<string, number>()
  const addTo = (row: MenuRow) => {
    perFileActions.set(row.from, (perFileActions.get(row.from) ?? 0) + 1)
  }

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    // 000037 型纯改挂迁移无 INSERT——含任一 menus 写语句的文件都进重放
    // （每个解析出的动作——INSERT 行 / UPDATE 改挂目标——计入 perFileActions）
    if (!/INSERT INTO menus|UPDATE menus SET parent_id/.test(sql)) continue

    type Ev = { at: number; run: () => void }
    const events: Ev[] = []

    // 形态 A：INSERT INTO menus (cols) VALUES (...),(...);
    const formA = /INSERT INTO menus \(([^)]+)\)\s*VALUES\s*([\s\S]*?);/g
    for (const m of sql.matchAll(formA)) {
      const cols = m[1].split(',').map((c) => c.trim())
      const rows = tuplesOf(m[2]).map((tup) => {
        const cells = splitTopLevel(tup)
        const cell = (name: string) => cells[cols.indexOf(name)] ?? ''
        const row: MenuRow = {
          code: unquote(cell('code')),
          parent: parentOf(cell('parent_id')),
          menuType: parseInt(cell('menu_type'), 10),
          component: unquote(cell('component')),
          visible: cell('visible') ? !/^false$/i.test(cell('visible')) : true,
          from: file,
        }
        return row
      })
      events.push({
        at: m.index ?? 0,
        run: () => {
          for (const row of rows) {
            addTo(row)
            if (!byCode.has(row.code)) byCode.set(row.code, row) // ON CONFLICT DO NOTHING = 首写胜
          }
        },
      })
    }

    // 形态 B（按钮块）：INSERT INTO menus (...) SELECT ... FROM (VALUES (...)) AS v(...)
    const formB = /INSERT INTO menus\s*\([^)]*\)\s*SELECT[\s\S]*?FROM \(VALUES([\s\S]*?)\)\s*AS v/g
    for (const m of sql.matchAll(formB)) {
      const count = tuplesOf(m[1]).length
      events.push({
        at: m.index ?? 0,
        run: () => {
          for (let i = 0; i < count; i++) {
            addTo({ code: `(btn#${i}@${file})`, parent: null, menuType: 3, component: '', visible: true, from: file })
          }
        },
      })
    }

    // 形态 C（按钮单行）：INSERT INTO menus (...) SELECT ... FROM menus p WHERE p.code = 'x'
    const formC = /INSERT INTO menus\s*\([^)]*\)\s*SELECT[\s\S]*?FROM menus p WHERE p\.code = '([^']+)'[\s\S]*?;/g
    for (const m of sql.matchAll(formC)) {
      const parent = m[1]
      events.push({
        at: m.index ?? 0,
        run: () => addTo({ code: `(btn@${file}→${parent})`, parent, menuType: 3, component: '', visible: true, from: file }),
      })
    }

    // 改挂：UPDATE menus SET parent_id = (SELECT ... code='x') WHERE code = 'y' / IN (...)
    const upd = /UPDATE menus SET parent_id = \(SELECT id FROM menus WHERE code = '([^']+)'\)\s*WHERE code (?:= '([^']+)'|IN \(([^)]+)\))/g
    for (const m of sql.matchAll(upd)) {
      const newParent = m[1]
      const targets = m[2] ? [m[2]] : (m[3] ?? '').split(',').map((c) => c.trim().replace(/^'|'$/g, '')).filter(Boolean)
      events.push({
        at: m.index ?? 0,
        run: () => {
          for (const code of targets) {
            perFileActions.set(file, (perFileActions.get(file) ?? 0) + 1)
            const row = byCode.get(code)
            if (row) row.parent = newParent
          }
        },
      })
    }

    events.sort((a, b) => a.at - b.at)
    for (const ev of events) ev.run()
  }

  // 解析器盲区守卫：进重放的文件必须至少解析出一个动作（新语句形态漏解析→此处炸）
  for (const [file, n] of perFileActions) {
    expect(n, `${file} 含 menus 写语句但解析出 0 个动作——派生器漏了新语句形态，须补解析规则`).toBeGreaterThan(0)
  }
  return [...byCode.values()]
}

/** ─── 期望名单派生 + 断言 ─── */

/** 全部视图文件（小写路径索引——component 解析走 routerHelper 同款双候选：
 *  单段 component=文件（home→views/Home/index.vue 命中第二候选），多段含 /index=第一候选） */
function viewIndex(): Map<string, string> {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (name.endsWith('.vue')) out.push(p)
    }
    return out
  }
  const entries = walk(VIEWS_DIR).map((p) => ['views/' + p.slice(VIEWS_DIR.length + 1), p] as [string, string])
  return new Map(entries.map(([k, p]) => [k.toLowerCase(), p]))
}

const menuRows = deriveMenuRows()
const IDX = viewIndex()

/** 页面行（menu_type=2 或 1 带组件；visible；有 component）→ [视图文件, 期望组件名] */
const DERIVED: Array<[string, string]> = menuRows
  .filter((r) => r.menuType !== 3 && r.visible && r.component)
  .filter((r) => r.menuType === 2 || (r.menuType === 1 && r.component !== ''))
  .map((r) => {
    const c = r.component.toLowerCase().replace(/^\/+/, '').replace(/\.vue$/i, '')
    const key = [`views/${c}.vue`, `views/${c}/index.vue`].find((k) => IDX.has(k))
    expect(
      key,
      `种子页面 ${r.code}（component=${r.component}，期望组件名 ${r.parent === null ? r.code + '_page' : r.code}）无对应视图文件——visible 种子须有落成页面`,
    ).toBeDefined()
    const actual = IDX.get(key!)
    return [
      actual!.slice(REPO_ROOT.length + 1),
      r.parent === null ? `${r.code}_page` : r.code,
    ] as [string, string]
  })

/** 常量路由实名（§3.2④ 静态补充路由——前端自有，无种子可派生） */
const STATIC_ROUTES: Array<[string, string]> = [
  ['src/views/Profile/index.vue', 'Profile'],
  ['src/views/MyOrg/index.vue', 'MyOrg'],
  ['src/views/ticket/create/index.vue', 'TicketCreate'],
  ['src/views/ticket/detail/index.vue', 'TicketDetail'],
]

test('种子派生 sanity：页面行 ≥12（少于=派生器漏形态，检查 contribute 守卫）', () => {
  expect(DERIVED.length).toBeGreaterThanOrEqual(12)
})

test.each([...DERIVED, ...STATIC_ROUTES])(
  '%s 声明了与路由名一致的 defineOptions name（%s）',
  (file, expected) => {
    const source = readFileSync(join(REPO_ROOT, file), 'utf-8')
    // ^\s* 行首锚定（m 标志）：注释行 `// defineOptions(...)` 不得假绿（检视 P3）
    expect(source).toMatch(new RegExp(`^\\s*defineOptions\\(\\{\\s*name:\\s*'${expected}'`, 'm'))
  },
)

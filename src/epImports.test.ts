/**
 * EP 组件导入完整性扫描（复核报告-2026-10-03 建议固化）
 *
 * 项目**不全局注册 Element Plus**——每个 SFC 模板里的 `el-*` 标签必须在
 * 本文件 `import { ElXxx } from 'element-plus'` 中有对应导入。缺失时 Vue
 * 运行时 warn「Failed to resolve component」+ 渲染为未解析自定义元素
 * （功能静默失效：分页器隐形/对话框退化为内联块/错误提示不显示）。
 *
 * 静态门禁（eslint/vue-tsc/build）**均不检查模板组件是否已导入**——
 * 本测试是「模板 el-* 缺 import」一类的唯一自动捕获层（已捕获并修复 3 处：
 * 复核报告 review-missing-el-imports-2026-10-03 的 audit/log+al/types+system/user）。
 *
 * **不含**另一类「字符串 prefix-icon/suffix-icon 未注册名」缺陷——根因不同
 * （EP input 字符串值经 resolveDynamicComponent 把未注册名当标签渲成未知原生元素
 * =死图标），由本文件第二个用例（字符串闸，2026-10-03 增）覆盖；该类历史已修 5 处
 * （四轮审计 #7 批 fc027b8e：LoginForm×2 + ChangePassword×3）。
 *
 * 排除：ElMessage/ElMessageBox/ElNotification 等函数式调用（无模板标签）；
 * ElLoading 全局注册；keep-alive/transition 等 Vue 内置。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(fileURLToPath(import.meta.url), '..'))

/** 模板标签 → 所需导入名映射（el-form-item → ElFormItem） */
function tagToImport(tag: string): string {
  return 'El' + tag
    .replace(/^el-/, '')
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('')
}

/** 无需导入的标签（全局注册/Vue 内建/函数式调用） */
const EXEMPT = new Set([
  'el-loading', // plugins 全局 app.use(ElLoading)
  'el-config-provider', // 未用但易误报（Vue 内建-like）
  'transition', 'keep-alive', 'component', 'slot', 'teleport', 'suspense',
])

/** 函数式调用（import 了但模板无标签——不算缺失，但确认 import 覆盖面） */
const FUNCTIONAL = new Set(['ElMessage', 'ElMessageBox', 'ElNotification', 'ElLoading'])

function walkVue(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkVue(p, out)
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

describe('EP 组件导入完整性（防静默失效）', () => {
  it('全仓 .vue 模板内 el-* 标签均有对应 ElXxx import', () => {
    // walkVue(ROOT) 从 src/ 根起扫——覆盖含 App.vue 在内的全部 .vue（48 文件），
    // 此前四目录拼装漏了根级 App.vue（复核报告 nit①；App.vue 现无 el-* 但根级是盲区）
    const files = walkVue(ROOT)
    expect(files.length, '扫描 .vue 文件数').toBeGreaterThanOrEqual(48)

    const violations: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      // 找 import { ElXxx, ... } from 'element-plus'
      const importMatch = src.match(/import\s*\{([^}]+)\}\s*from\s*'element-plus'/)
      const imports = new Set(
        (importMatch?.[1] ?? '')
          .split(',')
          .map((s) => s.trim().replace(/^type\s+/, ''))
          .filter(Boolean),
      )
      // 找模板内所有 <el-xxx 标签
      const tags = new Set<string>()
      for (const m of src.matchAll(/<el-[a-z][a-z0-9-]*/g)) {
        tags.add(m[0].slice(1)) // 去掉 <
      }
      // 检查每个用到的标签是否有对应导入
      for (const tag of tags) {
        if (EXEMPT.has(tag)) continue
        const needed = tagToImport(tag)
        if (!FUNCTIONAL.has(needed) && !imports.has(needed)) {
          violations.push(`${f}: <${tag}> 需要 import ${needed}（缺失 → 运行时静默失效）`)
        }
      }
    }

    expect(violations.join('\n'), 'EP 组件导入缺失（全仓扫描）').toBe('')
  })

  it('模板内无字符串 prefix-icon/suffix-icon（未注册名 → 死图标，静默失效）', () => {
    // 与上例**不同类**：prefix-icon 是属性而非标签，缺 import 扫描器覆盖不到。
    // 根因（EP 2.14.4 input）：字符串值经 resolveDynamicComponent 解析，未注册名以
    // 字符串为标签渲染未知原生元素（空、不可见）。正解 = #prefix/#suffix 插槽 +
    // 全局 <Icon>（fc027b8e 批 5 处已改）。绑定写法 `:prefix-icon="<组件>"` 不受影响。
    const files = walkVue(ROOT)
    expect(files.length, '扫描 .vue 文件数').toBeGreaterThanOrEqual(48)

    const violations: string[] = []
    for (const f of files) {
      // 去 HTML 注释，避免注释里提及的写法（如「字符串 prefix-icon 不渲染」）误报
      const src = readFileSync(f, 'utf-8').replace(/<!--[\s\S]*?-->/g, '')
      // 负向断言排除绑定写法：:prefix-icon="…" / v-bind:prefix-icon="…"
      for (const m of src.matchAll(/(?<![:\w-])(prefix|suffix)-icon\s*=\s*"/g)) {
        violations.push(`${f}: 字符串 ${m[1]}-icon="…"（应改 #${m[1]} 插槽 + <Icon>）`)
      }
    }

    expect(violations.join('\n'), 'prefix-icon/suffix-icon 字符串残留（死图标）').toBe('')
  })
})

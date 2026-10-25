/**
 * 请求路径前缀门禁（2026-10-25 固化）
 *
 * `@vea/request` 不设 baseURL——每个调用点必须自带网关前缀（`/api/…` 或 `/al/…`，与
 * vite.config.ts server.proxy 两条规则同源；生产由网关按同前缀分流）。漏前缀的调用在
 * 浏览器里**不会报错**：GET 命中 SPA fallback 拿回 index.html（v-for 把字符串逐字符渲染
 * 成上千行幽灵数据），POST 则 404 被信封层吞成通用提示——功能静默失效。
 *
 * 实例：src/api/storage 六个端点自建档起全部漏前缀（头像上传/附件列表上传删除/富文本渲染
 * 整面不可用），E2E 从未落浏览器、单测 mock 掉 request，静态门禁三件均不检查——本测试是
 * 该类缺陷唯一的自动捕获层。
 *
 * 扫描范围：src/ 下全部 .ts/.tsx/.vue（排除 src/common/request 自身与 *.test.*）；只检查
 * 字面量开头的 URL（变量 URL 无法静态判定，跳过）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(join(fileURLToPath(import.meta.url), '..', '..'))
const REQUEST_LAYER = join(SRC, 'common', 'request')

/** 与 vite.config.ts server.proxy 键同源 */
const ALLOWED_PREFIXES = ['/api/', '/al/']

const CALL_RE = /\brequest\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`$]*)/g

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (p === REQUEST_LAYER) continue
      walk(p, out)
    } else if (/\.(ts|tsx|vue)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe('request 调用路径必须自带网关前缀（防 SPA fallback 静默失效）', () => {
  it('src/ 下所有字面量 URL 以 /api/ 或 /al/ 开头', () => {
    const offenders: string[] = []
    let checked = 0
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf-8')
      for (const m of text.matchAll(CALL_RE)) {
        const literalHead = m[3]
        checked++
        if (!ALLOWED_PREFIXES.some((p) => literalHead.startsWith(p))) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${relative(SRC, file)}:${line} → request.${m[1]}(${m[2]}${literalHead}…)`)
        }
      }
    }
    expect(checked, '扫描面为零=正则或目录失配，测试本身失效').toBeGreaterThan(50)
    expect(offenders, `以下调用缺网关前缀：\n${offenders.join('\n')}`).toEqual([])
  })
})

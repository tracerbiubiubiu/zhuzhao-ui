/** 通知配置下拉必须覆盖后端实际接受的完整事件集合；缺主仓源文件不得跳过。 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const BACKEND_ROOT = resolve(UI_ROOT, process.env.ZHUZHAO_REPO ?? '../zhuzhao')

it('通知 EVENT_OPTIONS 与主仓 validEventActions 全集合一致（RR-DOC-01）', () => {
  const vue = readFileSync(resolve(UI_ROOT, 'src/views/system/notification/index.vue'), 'utf8')
  const script = vue.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('通知配置页 script 未解析；不能把扫描面丢失视为通过')
  const parsed = ts.createSourceFile('notification.ts', script, ts.ScriptTarget.Latest, true)
  const options = parsed.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'EVENT_OPTIONS')
  if (!options?.initializer || !ts.isArrayLiteralExpression(options.initializer)) {
    throw new Error('生产 EVENT_OPTIONS 不是可解析数组；须更新真实词表读取规则')
  }
  const frontend = options.initializer.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) throw new Error('事件选项必须可枚举，不能静默跳过')
    const value = element.properties.find((property) => ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'value')
    if (!value || !ts.isPropertyAssignment(value) || !ts.isStringLiteral(value.initializer)) {
      throw new Error('事件 value 必须是可解析字符串，不能静默跳过')
    }
    return value.initializer.text
  })

  const go = readFileSync(resolve(BACKEND_ROOT, 'internal/service/message_admin_service.go'), 'utf8')
  const body = go.match(/\bvar\s+validEventActions\s*=\s*map\[string\]bool\s*\{([\s\S]*?)\n\}/)?.[1]
  if (!body) throw new Error('主仓 validEventActions 未解析；不能以空集合放行')
  const entries = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
  const entry = /"([a-z0-9_.]+)"\s*:\s*true\s*,/g
  const backend = [...entries.matchAll(entry)].map((match) => match[1]!)
  expect(entries.replace(entry, '').trim(), 'Go 词表出现未识别条目，须扩展解析而非漏检').toBe('')
  expect(backend.length, '后端词表不能为空；防扫描自身失效').toBeGreaterThan(0)
  expect(new Set(frontend).size, '前端事件选项重复').toBe(frontend.length)
  expect(new Set(backend).size, '后端事件键重复').toBe(backend.length)
  expect(frontend.sort(), '通知下拉必须与后端生产词表逐键一致，不能只对数量').toEqual(backend.sort())
})

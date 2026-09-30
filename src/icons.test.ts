/**
 * 菜单图标映射表单测（01 §1「icon 种子值建集中映射表解析」）
 *
 * 钉死三件事：
 *  1. 全部种子 icon 裸名（跨菜单迁移枚举）都有映射——漏一个=侧栏该项图标空白；
 *  2. 映射目标全部已在注册表——映射到未注册名同样零渲染（双重静默失败）；
 *  3. settings/setting 近似键并存照抄种子（设计文档 ⚠ 明示勿「纠正」拼写）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MENU_ICON_MAP, resolveMenuIcon, icons } from './icons'

/** 复检新增缺口（2026-10-01）：视图内直写的 icon="mdi:..." 字面量不在种子链上——
 *  拼错名（如 lock-outlien）侧栏测试照绿、图标静默零渲染（离线 iconify 未知名不渲染）。
 *  本用例扫全部视图/布局模板字面量，逐个断言在注册表内。 */
describe('视图内直写图标名', () => {
  it('icon="mdi:..." 字面量全部已注册（拼错=静默零渲染）', () => {
    const root = resolve(join(fileURLToPath(import.meta.url), '../..'))
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (name.endsWith('.vue')) out.push(p)
      }
      return out
    }
    const files = [...walk(join(root, 'src', 'views')), ...walk(join(root, 'src', 'layout'))]
    const used = new Set<string>()
    for (const f of files) {
      for (const m of readFileSync(f, 'utf-8').matchAll(/\bicon="mdi:[a-z0-9-]+"/g)) {
        used.add(m[0].slice('icon="'.length, -1))
      }
    }
    // 扫描器自检：一个都扫不到=目录挪了/正则失效（防测试自身假绿）
    expect(used.size, '未扫到任何视图 mdi: 字面量——检查 views/layout 目录与正则').toBeGreaterThan(0)
    const registry = icons as unknown as Record<string, unknown>
    for (const name of used) {
      expect(registry[name], `视图直写图标 "${name}" 未在 icons.ts 注册——将静默零渲染`).toBeDefined()
    }
  })
})

/** 主仓菜单种子 icon 裸名全集（000002/000010/000018/000022/000024/000025/000034——新迁移加菜单须同步） */
const SEED_ICON_NAMES = [
  'home', 'settings', 'user', 'role', 'menu', 'org',
  'ticket', 'ticket-list', 'setting',
  'task', 'task-list',
  'al', 'al-data', 'al-types',
  'audit-log', 'dict', 'notification',
]

describe('菜单图标映射表', () => {
  it('种子 icon 裸名全量覆盖（漏映射=侧栏图标静默空白）', () => {
    for (const name of SEED_ICON_NAMES) {
      expect(MENU_ICON_MAP[name], `种子 icon "${name}" 未映射`).toBeDefined()
    }
  })

  it('映射目标全部已注册（映射到未注册名同样零渲染）', () => {
    for (const name of Object.keys(MENU_ICON_MAP)) {
      const target = MENU_ICON_MAP[name]
      const registered = icons as unknown as Record<string, unknown>
      expect(registered[target], `映射目标 "${target}" 未注册`).toBeDefined()
    }
  })

  it('未知 icon 裸名走 warn-once 返回原值（不阻断渲染链）', () => {
    expect(resolveMenuIcon('nonexistent-xyz')).toBe('nonexistent-xyz')
  })

  it('settings/setting 近似键并存（种子照抄——勿「纠正」）', () => {
    expect(MENU_ICON_MAP['settings']).toBeDefined()
    expect(MENU_ICON_MAP['setting']).toBeDefined()
    expect(MENU_ICON_MAP['settings']).not.toBe(MENU_ICON_MAP['setting'])
  })
})

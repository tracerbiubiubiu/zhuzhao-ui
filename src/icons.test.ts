/**
 * 菜单图标映射表单测（01 §1「icon 种子值建集中映射表解析」）
 *
 * 钉死三件事：
 *  1. 全部种子 icon 裸名（跨六个菜单迁移枚举）都有映射——漏一个=侧栏该项图标空白；
 *  2. 映射目标全部已在注册表——映射到未注册名同样零渲染（双重静默失败）；
 *  3. settings/setting 近似键并存照抄种子（设计文档 ⚠ 明示勿「纠正」拼写）。
 */
import { describe, it, expect } from 'vitest'
import { MENU_ICON_MAP, resolveMenuIcon, icons } from './icons'

/** 主仓菜单种子 icon 裸名全集（000002/000010/000018/000022/000024/000025——新迁移加菜单须同步） */
const SEED_ICON_NAMES = [
  'home', 'settings', 'user', 'role', 'menu', 'org',
  'ticket', 'ticket-list', 'setting',
  'task', 'task-list',
  'al', 'al-data', 'al-types',
  'audit-log',
]

describe('菜单图标映射表', () => {
  it('种子 icon 裸名全量覆盖（漏映射=侧栏图标静默空白）', () => {
    for (const name of SEED_ICON_NAMES) {
      expect(MENU_ICON_MAP[name], `种子 icon "${name}" 未映射`).toBeDefined()
    }
  })

  it('映射目标全部已注册（映射到未注册名同样零渲染）', () => {
    const registered = new Set(Object.keys(icons))
    for (const [seed, target] of Object.entries(MENU_ICON_MAP)) {
      expect(registered.has(target), `"${seed}" → "${target}" 目标未注册`).toBe(true)
    }
  })

  it('近似键并存：settings 与 setting 是两个不同种子键（照抄勿纠正）', () => {
    expect(MENU_ICON_MAP['settings']).toBeDefined()
    expect(MENU_ICON_MAP['setting']).toBeDefined()
    expect(MENU_ICON_MAP['settings']).not.toBe(MENU_ICON_MAP['setting'])
  })

  it('resolveMenuIcon：裸名查表 / namespaced 直通 / 未知值直通+warn 一次 / 空串安全', () => {
    expect(resolveMenuIcon('home')).toBe('mdi:home')
    expect(resolveMenuIcon('mdi:home')).toBe('mdi:home')
    expect(resolveMenuIcon('')).toBe('')
    // 未知裸名直通（渲染为空但不阻断），重复调用不重复告警（warn-once 由 Set 保证）
    expect(resolveMenuIcon('future-menu')).toBe('future-menu')
    expect(resolveMenuIcon('future-menu')).toBe('future-menu')
  })
})

/**
 * 菜单图标映射表单测（01 §1「icon 种子值建集中映射表解析」）
 *
 * 钉死三件事：
 *  1. 全部种子 icon 裸名（跨菜单迁移枚举）都有映射——漏一个=侧栏该项图标空白；
 *  2. 映射目标全部已在注册表——映射到未注册名同样零渲染（双重静默失败）；
 *  3. settings/setting 近似键并存照抄种子（设计文档 ⚠ 明示勿「纠正」拼写）。
 */
import { describe, it, expect } from 'vitest'
import { MENU_ICON_MAP, resolveMenuIcon, icons } from './icons'

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

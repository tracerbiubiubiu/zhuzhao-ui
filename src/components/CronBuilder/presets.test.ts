/**
 * CronBuilder presets 纯函数测试（S4 B4-2——04 号 A.3/A.5：四类预设生成/反解析/
 * 非法值双检承重；六段带秒输入必拒）。
 */
import { describe, expect, it } from 'vitest'
import { presetToSpec, specToPreset, validatePreset, validateSpec } from './presets'

describe('presetToSpec 四类预设生成', () => {
  it('每天 09:30 → 30 9 * * *', () => {
    expect(presetToSpec({ kind: 'daily', hour: 9, minute: 30 })).toBe('30 9 * * *')
  })
  it('每周一 08:00 → 0 8 * * 1', () => {
    expect(presetToSpec({ kind: 'weekly', hour: 8, minute: 0, day: 1 })).toBe('0 8 * * 1')
  })
  it('每 6 小时 → 0 */6 * * *（整点起）', () => {
    expect(presetToSpec({ kind: 'hourly', hour: 6 })).toBe('0 */6 * * *')
  })
  it('每月 1 号 00:05 → 5 0 1 * *', () => {
    expect(presetToSpec({ kind: 'monthly', hour: 0, minute: 5, day: 1 })).toBe('5 0 1 * *')
  })
})

describe('specToPreset 反解析（可识别回显/不可识别 null）', () => {
  it.each([
    ['30 9 * * *', { kind: 'daily', hour: 9, minute: 30 }],
    ['0 8 * * 0', { kind: 'weekly', hour: 8, minute: 0, day: 0 }],
    ['5 0 1 * *', { kind: 'monthly', hour: 0, minute: 5, day: 1 }],
  ])('%s → %j', (spec, want) => {
    expect(specToPreset(spec)).toEqual(want)
  })
  it('0 */4 * * * → hourly 间隔 4', () => {
    expect(specToPreset('0 */4 * * *')).toEqual({ kind: 'hourly', hour: 4 })
  })
  it.each([
    ['*/15 * * * *'],   // 步进分钟——非预设域
    ['30 9 * * 1-5'],   // 周区间
    ['30 9 1,15 * *'],  // 多日
    ['0 12 * * * *'],   // 六段（带秒）——非五段
  ])('%s 不可识别 → null（保持专家态）', (spec) => {
    expect(specToPreset(spec)).toBeNull()
  })
})

describe('validatePreset 预检', () => {
  it('合法四类零错误', () => {
    expect(validatePreset({ kind: 'daily', hour: 9, minute: 30 })).toBe('')
    expect(validatePreset({ kind: 'hourly', hour: 1 })).toBe('')
    expect(validatePreset({ kind: 'monthly', hour: 23, minute: 59, day: 31 })).toBe('')
  })
  it('负向：分钟/小时/星期/日期/间隔越界', () => {
    expect(validatePreset({ kind: 'daily', hour: 9, minute: 60 })).toContain('分钟')
    expect(validatePreset({ kind: 'daily', hour: 24, minute: 0 })).toContain('小时')
    expect(validatePreset({ kind: 'weekly', hour: 9, minute: 0, day: 7 })).toContain('星期')
    expect(validatePreset({ kind: 'monthly', hour: 9, minute: 0, day: 32 })).toContain('日期')
    expect(validatePreset({ kind: 'hourly', hour: 0 })).toContain('间隔')
    expect(validatePreset({ kind: 'hourly', hour: 24 })).toContain('间隔')
  })
})

describe('validateSpec 五段粗检', () => {
  it('六段带秒必拒（taskrunner parser 无秒字段——A.5 负向必测）', () => {
    expect(validateSpec('0 30 9 * * *')).toContain('五段')
  })
  it('非五段/空/非法字符', () => {
    expect(validateSpec('')).toContain('不能为空')
    expect(validateSpec('30 9 * *')).toContain('五段')
    expect(validateSpec('a b c d e')).toContain('非法字符')
  })
  it('合法五段通过（含步进/区间）', () => {
    expect(validateSpec('30 9 * * 1-5')).toBe('')
    expect(validateSpec('*/15 * * * *')).toBe('')
  })
})

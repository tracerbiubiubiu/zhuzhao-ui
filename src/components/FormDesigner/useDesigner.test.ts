/**
 * useDesigner 状态机测试（B1-1 设计器壳——测试先行）。
 *
 * 覆盖：add/select/remove/move（排序=sortablejs onEnd 的无 DOM 形态）/
 * update patch / serialize 快照 / key 即时校验（输入侧）与查重边界。
 */
import { describe, expect, it } from 'vitest'
import { createDesignerState } from './useDesigner'

const D = () => createDesignerState()

describe('增删选排', () => {
  it('add 产递增默认键与序；select/remove 正确', () => {
    const s = D()
    s.add('input'); s.add('select'); s.add('tips')
    expect(s.fields.value).toHaveLength(3)
    expect(s.fields.value[0].field_key).toBe('field_1')
    expect(s.fields.value[2].field_key).toBe('') // tips 非输入型无键
    expect(s.selected.value).toBe(2)
    s.select(0); s.remove(0)
    expect(s.fields.value).toHaveLength(2)
    expect(s.fields.value[0].field_type).toBe('select')
    expect(s.fields.value.map((f) => f.sort_order)).toEqual([1, 2])
  })

  it('move 重排并保持选中跟随（sortablejs onEnd → move）', () => {
    const s = D()
    s.add('input'); s.add('textarea'); s.add('number')
    s.select(2)
    s.move(2, 0) // 拖到首位
    expect(s.fields.value.map((f) => f.field_type)).toEqual(['number', 'input', 'textarea'])
    expect(s.selected.value).toBe(0)
    expect(s.fields.value.map((f) => f.sort_order)).toEqual([1, 2, 3])
    expect(() => s.move(0, 9)).not.toThrow() // 越界钳制
    expect(s.fields.value).toHaveLength(3)
  })
})

describe('update 与 key 即时校验', () => {
  it('update patch 部分字段', () => {
    const s = D()
    s.add('input'); s.select(0)
    s.update(0, { field_label: '主机 IP', required: true })
    expect(s.fields.value[0].field_label).toBe('主机 IP')
    expect(s.fields.value[0].required).toBe(true)
  })

  it('keyError：非法/重复即时报，合法清空', () => {
    const s = D()
    s.add('input'); s.add('input')
    s.update(1, { field_key: s.fields.value[0].field_key }) // 与第 0 个重复
    expect(s.keyError(1)).toContain('重复')
    s.update(1, { field_key: '1bad' })
    expect(s.keyError(1)).toBeTruthy()
    s.update(1, { field_key: 'good_key' })
    expect(s.keyError(1)).toBe('')
  })

  it('regexError：语法错误即时报', () => {
    const s = D()
    s.add('input'); s.select(0)
    s.update(0, { validate_regex: '[bad' })
    expect(s.regexError(0)).toBeTruthy()
    s.update(0, { validate_regex: '^ok$' })
    expect(s.regexError(0)).toBe('')
  })
})

describe('serialize 与校验闸', () => {
  it('serialize 直接产 Input 数组；有错误时 saveBlocked=true', () => {
    const s = D()
    s.add('input'); s.select(0)
    s.update(0, { field_key: 'ip', field_label: 'IP', validate_regex: '^\\d' })
    expect(s.serialize()).toHaveLength(1)
    expect(s.serialize()[0]).toMatchObject({ field_key: 'ip', validate_regex: '^\\d', sort_order: 1 })
    expect(s.saveBlocked()).toBe(false)
    s.update(0, { validate_regex: '(' })
    expect(s.saveBlocked()).toBe(true)
  })

  it('loadFromDefs 重置（dialog 打开时从后端字段初始化）', () => {
    const s = D()
    s.loadFromDefs([
      { id: '1', type_code: 't', field_key: 'a', field_label: 'A', field_type: 'richtext', required: false, sort_order: 1 },
      { id: '2', type_code: 't', field_key: 'b', field_label: 'B', field_type: 'select', required: true, sort_order: 2, field_options: [{ value: 'x', label: 'X' }] },
    ] as never[])
    expect(s.fields.value).toHaveLength(2)
    expect(s.fields.value[1].field_options).toEqual([{ label: 'X', value: 'x' }])
    expect(s.selected.value).toBe(-1)
  })
})

/**
 * schemaAdapter 纯逻辑测试（B1-1 设计器壳——测试先行，01 号 §3.1/§8）。
 *
 * 契约：TicketTypeFieldDef（后端） ↔ DesignerField（设计器内部模型）双向无损，
 * 序列化产物 = TicketTypeFieldInput[]（与专家模式同一 replace 管线）。
 * 负向：非法 key / 重复 key / 选项类型空选项 / 非法正则 ——须在 validate() 报告。
 */
import { describe, expect, it } from 'vitest'
import { defToDraft, serialize, validateDraft } from './schemaAdapter'
import type { TicketTypeFieldDef } from '@/api/ticket'

const def = (over: Partial<TicketTypeFieldDef>): TicketTypeFieldDef => ({
  id: '1', type_code: 't', field_key: 'k', field_label: 'L', field_type: 'input',
  required: false, sort_order: 1, ...over,
})

describe('defToDraft 归一', () => {
  it('field_options 双形态归一：字符串数组 / {value,label} 数组', () => {
    const a = defToDraft(def({ field_type: 'select', field_options: ['x', 'y'] }))
    expect(a.field_options).toEqual([
      { label: 'x', value: 'x' }, { label: 'y', value: 'y' },
    ])
    const b = defToDraft(def({ field_type: 'select', field_options: [{ value: 'h', label: '高' }] }))
    expect(b.field_options).toMatchObject([{ label: '高', value: 'h' }])
  })

  it('八类型全覆盖（含 richtext——B5-4 第八种）', () => {
    const types = ['input', 'textarea', 'number', 'date', 'select', 'multi_select', 'tips', 'richtext'] as const
    for (const t of types) {
      const d = defToDraft(def({ field_type: t, field_key: t === 'tips' ? '' : `f_${t}` }))
      expect(d.field_type).toBe(t)
    }
  })

  it('未重新排序时保留 validate_regex 和 sort_order', () => {
    const d1 = defToDraft(def({ validate_regex: '^\\d+$', sort_order: 9 }))
    expect(d1.validate_regex).toBe('^\\d+$')
    const list = [defToDraft(def({ sort_order: 9, field_key: 'a' })), defToDraft(def({ sort_order: 1, field_key: 'b' }))]
    const out = serialize(list)
    expect(out.map((f) => f.sort_order)).toEqual([9, 1])
  })
})

describe('serialize → TicketTypeFieldInput 形态', () => {
  it('保留选项的值、对象形式和扩展属性，支持单独改标签', () => {
    const options = [{ label: '高', value: 'h', color: 'red' }, '低']
    const d = defToDraft(def({ field_type: 'select', field_options: options }))
    expect(serialize([d])[0].field_options).toEqual(options)
    d.field_options![0].label = '高风险'
    expect(serialize([d])[0].field_options).toEqual([{ label: '高风险', value: 'h', color: 'red' }, '低'])
  })

  it('新选项可以仅填标签，显式填写的值独立保存', () => {
    const d = defToDraft(def({ field_type: 'select' }))
    d.field_options = [{ label: '仅标签', value: '' }, { label: '显示名', value: 'stable' }]
    expect(validateDraft([d])).toEqual([])
    expect(serialize([d])[0].field_options).toEqual(['仅标签', { label: '显示名', value: 'stable' }])
  })

  it('非选项类型不产 field_options；空 regex 不产 validate_regex（omitempty 语义）', () => {
    const out = serialize([defToDraft(def({ field_type: 'input', validate_regex: '' }))])
    expect(out[0].field_options).toBeUndefined()
    expect(out[0].validate_regex).toBeUndefined()
  })

  it('往返一致：defToDraft → serialize 保 key/label/type/required/regex', () => {
    const src = def({
      field_type: 'multi_select', field_key: 'sev', field_label: '级别', required: true,
      validate_regex: '^a', field_options: [{ value: 'h', label: '高' }],
    })
    const out = serialize([defToDraft(src)])
    expect(out[0]).toMatchObject({
      field_key: 'sev', field_label: '级别', field_type: 'multi_select', required: true, validate_regex: '^a',
      field_options: [{ value: 'h', label: '高' }],
    })
  })

  it('改一项仍保留文件白名单、未知元数据和未经修改的旧校验', () => {
    const file = defToDraft(def({
      field_key: '证据', field_type: 'file', field_options: ['image/png', 'application/pdf'], sort_order: 42,
    }))
    const number = defToDraft(def({
      field_key: 'total', field_type: 'number', field_options: [], sort_order: 47,
      field_meta: { formula: '1+2', visible_when: 'qty > 0', extension: { scale: 1 } },
    }))
    const input = defToDraft(def({ field_key: 'legacy', validate_regex: '(?i)old' }))
    file.field_label = '新名称'
    number.visible_when = ''
    const out = serialize([file, number, input])
    expect(validateDraft([file, number, input])).toEqual([])
    expect(out[0]).toMatchObject({ field_key: '证据', field_label: '新名称', field_options: ['image/png', 'application/pdf'], sort_order: 42 })
    expect(out[1].field_options).toBeUndefined()
    expect(out[1].field_meta).toEqual({ formula: '1+2', extension: { scale: 1 } })
    expect(out[2].validate_regex).toBe('(?i)old')
  })
})

describe('validateDraft 负向（保存前闸）', () => {
  const base = defToDraft(def({}))

  it('key 非法：非字母开头 / 非 ASCII slug / 重复', () => {
    const bad1 = { ...base, field_key: '1abc' }
    const bad2 = { ...base, field_key: 'a-b' }
    const good = { ...base, field_key: 'ok_key' }
    const dup = { ...base, field_key: 'ok_key' }
    const errs = validateDraft([good, { ...bad1 }, { ...bad2 }, { ...dup }])
    expect(errs).toHaveLength(3)
    expect(errs.every((e) => e.field_index >= 1)).toBe(true)
  })

  it('tips 无 key 放行（非输入型不校验 key）；空 label 拒', () => {
    const tips = defToDraft(def({ field_type: 'tips', field_key: '' }))
    expect(validateDraft([tips])).toHaveLength(0)
    expect(validateDraft([{ ...tips, field_label: '' }])).toHaveLength(1)
  })

  it('选项类型空选项拒；regex 语法错误拒（即时校验的保存侧兜底）', () => {
    const sel = defToDraft(def({ field_type: 'select', field_options: [] }))
    const badRe = { ...base, validate_regex: '[unclosed' }
    expect(validateDraft([sel])).toHaveLength(1)
    expect(validateDraft([badRe])).toHaveLength(1)
  })
})

describe('B1-2 字典引用（dict:<code> 形态）', () => {
  it('defToDraft 解析单元素 dict: 引用 → dictRef；serialize 回写', () => {
    const d = defToDraft(def({ field_type: 'select', field_options: ['dict:severity'] }))
    expect(d.dictRef).toBe('severity')
    expect(d.field_options).toBeNull()
    const out = serialize([d])
    expect(out[0].field_options).toEqual(['dict:severity'])
  })

  it('非 dict: 普通选项不受影响（无 dictRef）', () => {
    const d = defToDraft(def({ field_type: 'select', field_options: ['高', '中'] }))
    expect(d.dictRef).toBeUndefined()
    expect(serialize([d])[0].field_options).toEqual(['高', '中'])
  })

  it('validateDraft：挂字典模式 dictRef 空拒；dictRef 存在时不走空选项校验', () => {
    const withRef = defToDraft(def({ field_type: 'select', field_options: ['dict:sev'] }))
    expect(validateDraft([withRef])).toHaveLength(0)
    const noRef = { ...withRef, dictRef: '', field_options: null }
    expect(validateDraft([noRef])).toHaveLength(1)
  })
})

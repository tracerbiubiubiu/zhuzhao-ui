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
    expect(b.field_options).toEqual([{ label: '高', value: 'h' }])
  })

  it('八类型全覆盖（含 richtext——B5-4 第八种）', () => {
    const types = ['input', 'textarea', 'number', 'date', 'select', 'multi_select', 'tips', 'richtext'] as const
    for (const t of types) {
      const d = defToDraft(def({ field_type: t, field_key: t === 'tips' ? '' : `f_${t}` }))
      expect(d.field_type).toBe(t)
    }
  })

  it('validate_regex 与 sort_order 保留；sort_order 按数组序重排', () => {
    const d1 = defToDraft(def({ validate_regex: '^\\d+$', sort_order: 9 }))
    expect(d1.validate_regex).toBe('^\\d+$')
    const list = [defToDraft(def({ sort_order: 9, field_key: 'a' })), defToDraft(def({ sort_order: 1, field_key: 'b' }))]
    const out = serialize(list)
    expect(out.map((f) => f.sort_order)).toEqual([1, 2])
  })
})

describe('serialize → TicketTypeFieldInput 形态', () => {
  it('选项类型产 field_options 字符串数组（label 为准——与专家模式一致）', () => {
    const out = serialize([
      defToDraft(def({ field_type: 'select', field_options: [{ label: '高', value: 'h' }] })),
    ])
    expect(out[0].field_options).toEqual(['高'])
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
      field_options: ['高'],
    })
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

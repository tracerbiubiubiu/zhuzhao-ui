/**
 * FormDesigner 类型目录（B1-1 设计器壳——01 号 §3.1「先目录后包」三层分离）。
 *
 * 字段类型八枚 = 后端 validFieldTypes（richtext 第八种 B5-4 已扩）；
 * key/regex 校验与后端 G2 同款预检（服务端为 SSOT，前端仅即时反馈）。
 */

export type FieldType8 = 'input' | 'textarea' | 'number' | 'date' | 'select' | 'multi_select' | 'tips' | 'richtext'

export interface DesignerOption {
  label: string
  value: string
}

/** 设计器内部字段模型（schemaAdapter 负责 ↔ API 形态双向转换） */
export interface DesignerField {
  /** 画布 v-for key（实例内唯一，不参与序列化） */
  _uid: number
  field_key: string
  field_label: string
  field_type: FieldType8
  required: boolean
  /** 仅 select/multi_select 有；其余 null */
  field_options: DesignerOption[] | null
  validate_regex: string
  sort_order: number
}

/** 物料目录：label=展示名；hasKey=输入型（tips 纯展示无键）；hasOptions=选项型 */
export const FIELD_CATALOG: ReadonlyArray<{
  type: FieldType8
  label: string
  hasKey: boolean
  hasOptions: boolean
}> = [
  { type: 'input', label: '单行文本', hasKey: true, hasOptions: false },
  { type: 'textarea', label: '多行文本', hasKey: true, hasOptions: false },
  { type: 'number', label: '数字', hasKey: true, hasOptions: false },
  { type: 'date', label: '日期', hasKey: true, hasOptions: false },
  { type: 'select', label: '单选下拉', hasKey: true, hasOptions: true },
  { type: 'multi_select', label: '多选下拉', hasKey: true, hasOptions: true },
  { type: 'tips', label: '提示文本', hasKey: false, hasOptions: false },
  { type: 'richtext', label: '富文本', hasKey: true, hasOptions: false },
]

export const catalogOf = (t: FieldType8) => FIELD_CATALOG.find((c) => c.type === t)!

/** 后端 G2 同款：字母开头 ASCII slug（预检——服务端为 SSOT） */
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

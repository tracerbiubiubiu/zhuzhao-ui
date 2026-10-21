/**
 * schema 适配层（B1-1 三层分离之一——纯函数，vitest 直测）。
 *
 * TicketTypeFieldDef（后端 GET）→ DesignerField（设计器）→ TicketTypeFieldInput[]（replace 管线）。
 * 语义对齐专家模式既有口径：field_options 双形态归一（label 为准）；空 regex 不产字段（omitempty）。
 */
import type { TicketTypeFieldDef, TicketTypeFieldInput } from '@/api/ticket'
import { KEY_PATTERN, type DesignerField, type FieldType8 } from './types'

/** field_options 双形态归一：字符串数组 / [{value,label}] 数组 → DesignerOption[] */
function normalizeOptions(raw: unknown): DesignerField['field_options'] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map((o) => {
    if (typeof o === 'object' && o !== null) {
      const rec = o as Record<string, unknown>
      const label = String(rec.label ?? rec.value ?? '')
      const value = String(rec.value ?? rec.label ?? '')
      return { label, value }
    }
    const s = String(o)
    return { label: s, value: s }
  })
}

const isOptionType = (t: FieldType8) => t === 'select' || t === 'multi_select'

/** B1-2 字典引用形态：单元素 "dict:<code>" → dictRef（01 号 §3.2 挂字典键） */
const DICT_PREFIX = 'dict:'
function parseDictRef(raw: unknown): string | undefined {
  if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith(DICT_PREFIX)) {
    return raw[0].slice(DICT_PREFIX.length)
  }
  return undefined
}

/** 设计器实例内 uid 分配器（schemaAdapter 纯函数——模块级递增即可，仅作 v-for key） */
let uidSeq = 0
export const nextUid = () => ++uidSeq

/** 后端字段定义 → 设计器模型（dialog 打开时初始化） */
export function defToDraft(f: TicketTypeFieldDef): DesignerField {
  const dictRef = parseDictRef(f.field_options)
  return {
    _uid: nextUid(),
    dictRef,
    field_key: f.field_key ?? '',
    field_label: f.field_label ?? '',
    field_type: f.field_type,
    required: !!f.required,
    field_options: isOptionType(f.field_type) && !dictRef ? normalizeOptions(f.field_options) : null,
    validate_regex: f.validate_regex ?? '',
    sort_order: f.sort_order ?? 0,
  }
}

/** 设计器模型 → replace 管线 Input（选项产 label 字符串数组——与专家模式一致） */
export function serialize(fields: DesignerField[]): TicketTypeFieldInput[] {
  return fields.map((f, i) => ({
    field_key: f.field_key.trim(),
    field_label: f.field_label.trim(),
    field_type: f.field_type,
    ...(isOptionType(f.field_type)
      ? f.dictRef
        ? { field_options: [`${DICT_PREFIX}${f.dictRef}`] }
        : { field_options: (f.field_options ?? []).map((o) => o.label).filter(Boolean) }
      : {}),
    required: f.required,
    ...(f.validate_regex.trim() ? { validate_regex: f.validate_regex.trim() } : {}),
    sort_order: i + 1,
  }))
}

export interface FieldError {
  field_index: number
  message: string
}

/** 保存前校验闸（即时校验的兜底——服务端 G2 仍为 SSOT） */
export function validateDraft(fields: DesignerField[]): FieldError[] {
  const errs: FieldError[] = []
  const seen = new Map<string, number>()
  fields.forEach((f, i) => {
    const isTips = f.field_type === 'tips'
    if (!isTips) {
      const key = f.field_key.trim()
      if (!key) errs.push({ field_index: i, message: '字段键不能为空' })
      else if (!KEY_PATTERN.test(key)) errs.push({ field_index: i, message: `字段键「${key}」非法：字母开头 ASCII（字母/数字/下划线）` })
      else if (seen.has(key)) errs.push({ field_index: i, message: `字段键「${key}」与第 ${seen.get(key)! + 1} 个字段重复` })
      else seen.set(key, i)
    }
    if (!f.field_label.trim()) errs.push({ field_index: i, message: '字段标签不能为空' })
    if (isOptionType(f.field_type)) {
      if (f.dictRef) {
        // 挂字典模式：引用 code 即合法（字典项存在性由删除守卫+消费端兜底）
      } else if (!(f.field_options ?? []).some((o) => o.label.trim())) {
        errs.push({ field_index: i, message: `「${f.field_label || '未命名字段'}」为选项类型，须挂字典或至少一个静态选项` })
      }
    }
    const re = f.validate_regex.trim()
    if (re) {
      try {
        new RegExp(re)
      } catch {
        errs.push({ field_index: i, message: `正则语法错误：${re}` })
      }
    }
  })
  return errs
}

export { isOptionType }

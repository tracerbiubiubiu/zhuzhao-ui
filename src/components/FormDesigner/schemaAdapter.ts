/**
 * schema 适配层（B1-1 三层分离之一——纯函数，vitest 直测）。
 *
 * TicketTypeFieldDef（后端 GET）→ DesignerField（设计器）→ TicketTypeFieldInput[]（replace 管线）。
 * 两种编辑模式共享同一份草稿。保留稳定选项值和编辑器未承载的配置。
 */
import type { TicketTypeFieldDef, TicketTypeFieldInput } from '@/api/ticket'
import { KEY_PATTERN, type DesignerField, type FieldType11 } from './types'

/** field_options 双形态归一：字符串数组 / [{value,label}] 数组 → DesignerOption[] */
function normalizeOptions(raw: unknown): DesignerField['field_options'] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map((o) => {
    if (typeof o === 'object' && o !== null) {
      const rec = o as Record<string, unknown>
      const label = String(rec.label ?? rec.value ?? '')
      const value = String(rec.value ?? rec.label ?? '')
      return { label, value, source: rec }
    }
    const s = String(o)
    return { label: s, value: s }
  })
}

const isOptionType = (t: FieldType11) => t === 'select' || t === 'multi_select' || t === 'radio'

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
    source: f,
    dictRef,
    field_key: f.field_key ?? '',
    field_label: f.field_label ?? '',
    field_type: f.field_type,
    required: !!f.required,
    field_options: isOptionType(f.field_type) && !dictRef ? normalizeOptions(f.field_options) : null,
    validate_regex: f.validate_regex ?? '',
    formula:
      (f as { field_meta?: { formula?: string } | null }).field_meta?.formula ?? '',
    col_span: (f.field_meta as { col_span?: number } | null | undefined)?.col_span,
    group: (f.field_meta as { group?: string } | null | undefined)?.group ?? '',
    visible_when: (f.field_meta as { visible_when?: string } | null | undefined)?.visible_when ?? '',
    sort_order: f.sort_order ?? 0,
  }
}

export function draftKey(f: DesignerField): string {
  return f.field_key === f.source?.field_key ? f.field_key : f.field_key.trim()
}

function fieldOptions(f: DesignerField): unknown {
  if (isOptionType(f.field_type)) {
    if (f.dictRef) return [`${DICT_PREFIX}${f.dictRef}`]
    return (f.field_options ?? [])
      .filter(({ label, value, source }) => source !== undefined || label.trim() || value.trim())
      .map(({ label, value, source }) => {
        if (source) {
          const previousLabel = String(source.label ?? source.value ?? '')
          const previousValue = String(source.value ?? source.label ?? '')
          return {
            ...source,
            ...(label === previousLabel ? {} : { label }),
            ...(value === previousValue ? {} : { value }),
          }
        }
        const nextValue = value.trim() ? value : label
        return label === nextValue ? nextValue : { label, value: nextValue }
      })
  }
  // 数字和评分的 GET 会带默认空数组，替换接口要求省略该属性。
  if (f.field_type === 'number' || f.field_type === 'rating') return undefined
  return f.field_type === f.source?.field_type ? f.source.field_options : undefined
}

/** 设计器模型 → replace 管线 Input */
export function serialize(fields: DesignerField[]): TicketTypeFieldInput[] {
  return fields.map((f) => {
    const options = fieldOptions(f)
    return {
      field_key: draftKey(f),
      field_label: f.field_label === f.source?.field_label ? f.field_label : f.field_label.trim(),
      field_type: f.field_type,
      ...(options === undefined ? {} : { field_options: options }),
      required: f.required,
      ...(f.validate_regex ? { validate_regex: f.validate_regex } : {}),
      ...buildFieldMeta(f),
      sort_order: f.sort_order ?? 0,
    }
  })
}

/** B1-6 批3：field_meta 合并构建（formula/col_span/group/visible_when 同列承载） */
function buildFieldMeta(f: DesignerField): { field_meta?: Record<string, unknown> } {
  const original = f.source?.field_meta
  const meta = { ...original }
  const edits = { formula: f.formula, col_span: f.col_span, group: f.group, visible_when: f.visible_when }
  for (const [key, value] of Object.entries(edits)) {
    const previous = original?.[key] ?? (key === 'col_span' ? undefined : '')
    if (value === previous) continue
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) delete meta[key]
    else meta[key] = value
  }
  return Object.keys(meta).length ? { field_meta: meta } : {}
}

export interface FieldError {
  field_index: number
  message: string
}

/** 保存前校验闸（即时校验的兜底——服务端 G2 仍为 SSOT） */
export function validateDraft(fields: DesignerField[], checkBrowserRegex = true): FieldError[] {
  const errs: FieldError[] = []
  const seen = new Map<string, number>()
  fields.forEach((f, i) => {
    const isTips = f.field_type === 'tips'
    if (!isTips) {
      const key = draftKey(f)
      if (!key) errs.push({ field_index: i, message: '字段键不能为空' })
      else if (key !== f.source?.field_key && !KEY_PATTERN.test(key)) errs.push({ field_index: i, message: `字段键「${key}」非法：字母开头 ASCII（字母/数字/下划线）` })
      else if (seen.has(key)) errs.push({ field_index: i, message: `字段键「${key}」与第 ${seen.get(key)! + 1} 个字段重复` })
      else seen.set(key, i)
    }
    if (!f.field_label.trim()) errs.push({ field_index: i, message: '字段标签不能为空' })
    if (isOptionType(f.field_type)) {
      if (f.dictRef) {
        // 挂字典模式：引用 code 即合法（字典项存在性由删除守卫+消费端兜底）
      } else if (!(f.field_options ?? []).some((o) => o.value.trim() || (!o.source && o.label.trim()))) {
        errs.push({ field_index: i, message: `「${f.field_label || '未命名字段'}」为选项类型，须挂字典或至少一个静态选项` })
      } else if ((f.field_options ?? []).some((o) => o.source && !o.value.trim())) {
        errs.push({ field_index: i, message: `「${f.field_label}」的选项须填写值` })
      }
    }
    if (f.formula.trim() && f.field_type !== 'number' && f.field_type !== 'input') {
      errs.push({ field_index: i, message: `「${f.field_label || f.field_key}」formula 仅允许 number/input 型字段` })
    }
    const re = f.validate_regex
    if (checkBrowserRegex && re && re !== f.source?.validate_regex) {
      try {
        new RegExp(re)
      } catch {
        errs.push({ field_index: i, message: `正则语法错误：${re}` })
      }
    }
    // B1-6 批3：col_span 1–24（与后端 G2 同款）
    if (f.col_span != null && (f.col_span < 1 || f.col_span > 24)) {
      errs.push({ field_index: i, message: `「${f.field_label || f.field_key}」col_span 须为 1–24` })
    }
  })
  return errs
}

export { isOptionType }

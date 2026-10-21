/**
 * 设计器状态编排层（B1-1 三层分离之二——纯状态机，无 DOM 依赖，vitest 直测）。
 *
 * SFC 层（index/Canvas/Property）消费本 composable；sortablejs onEnd → move()
 * 的映射在画布层完成（这里保持环境无关）。
 */
import { ref, type Ref } from 'vue'
import type { TicketTypeFieldDef, TicketTypeFieldInput } from '@/api/ticket'
import { defToDraft, serialize, validateDraft } from './schemaAdapter'
import { KEY_PATTERN, catalogOf, type DesignerField, type FieldType8 } from './types'
import { nextUid } from './schemaAdapter'

export interface DesignerState {
  fields: Ref<DesignerField[]>
  selected: Ref<number>
  add: (type: FieldType8) => void
  select: (idx: number) => void
  remove: (idx: number) => void
  /** sortablejs onEnd 语义：oldIndex → newIndex（越界钳制） */
  move: (from: number, to: number) => void
  update: (idx: number, patch: Partial<DesignerField>) => void
  addOption: (idx: number) => void
  removeOption: (idx: number, optIdx: number) => void
  updateOption: (idx: number, optIdx: number, patch: { label?: string; value?: string }) => void
  keyError: (idx: number) => string
  regexError: (idx: number) => string
  validate: () => ReturnType<typeof validateDraft>
  saveBlocked: () => boolean
  serialize: () => TicketTypeFieldInput[]
  loadFromDefs: (defs: TicketTypeFieldDef[]) => void
}

export function createDesignerState(): DesignerState {
  const fields = ref<DesignerField[]>([]) as Ref<DesignerField[]>
  const selected = ref(-1)
  // 实例级计数器（默认键 field_N）——非模块级，避免多实例/测试间串号
  let seq = 0

  const resort = () => fields.value.forEach((f, i) => (f.sort_order = i + 1))
  const clampIdx = (i: number) => Math.min(Math.max(i, 0), fields.value.length - 1)

  const api: DesignerState = {
    fields,
    selected,
    add(type) {
      const hasKey = catalogOf(type).hasKey
      seq += 1
      fields.value.push({
        _uid: nextUid(),
        field_key: hasKey ? `field_${seq}` : '',
        field_label: `${catalogOf(type).label}${seq}`,
        field_type: type,
        required: false,
        field_options: catalogOf(type).hasOptions ? [{ label: '选项一', value: 'opt1' }] : null,
        validate_regex: '',
        formula: '',
        sort_order: fields.value.length + 1,
      })
      selected.value = fields.value.length - 1
    },
    select(idx) {
      selected.value = idx >= 0 && idx < fields.value.length ? idx : -1
    },
    remove(idx) {
      if (idx < 0 || idx >= fields.value.length) return
      fields.value.splice(idx, 1)
      resort()
      selected.value = -1
    },
    move(from, to) {
      const len = fields.value.length
      if (len === 0) return
      const f = clampIdx(from), t = clampIdx(to)
      if (f === t) return
      const [m] = fields.value.splice(f, 1)
      fields.value.splice(t, 0, m)
      resort()
      selected.value = t
    },
    update(idx, patch) {
      const cur = fields.value[idx]
      if (!cur) return
      Object.assign(cur, patch)
      if (patch.field_type !== undefined) {
        // 类型切换：选项面随类型重建（选项型给默认一项；非选项型清空）
        cur.field_options = catalogOf(patch.field_type).hasOptions
          ? cur.field_options?.length ? cur.field_options : [{ label: '选项一', value: 'opt1' }]
          : null
        if (patch.field_type === 'tips') cur.field_key = ''
        if (!catalogOf(patch.field_type).hasOptions) cur.dictRef = undefined
      }
    },
    addOption(idx) {
      const cur = fields.value[idx]
      if (!cur || !cur.field_options) return
      cur.field_options.push({ label: '', value: '' })
    },
    removeOption(idx, optIdx) {
      const cur = fields.value[idx]
      if (!cur || !cur.field_options) return
      cur.field_options.splice(optIdx, 1)
    },
    updateOption(idx, optIdx, patch) {
      const cur = fields.value[idx]
      if (!cur || !cur.field_options) return
      Object.assign(cur.field_options[optIdx] ?? {}, patch)
    },
    keyError(idx) {
      const f = fields.value[idx]
      if (!f || f.field_type === 'tips') return ''
      const key = f.field_key.trim()
      if (!key) return '字段键不能为空'
      if (!KEY_PATTERN.test(key)) return '非法：字母开头，仅字母/数字/下划线'
      const dup = fields.value.findIndex((o, i) => i !== idx && o.field_key.trim() === key)
      if (dup >= 0) return `与第 ${dup + 1} 个字段重复`
      return ''
    },
    regexError(idx) {
      const f = fields.value[idx]
      if (!f) return ''
      const re = f.validate_regex.trim()
      if (!re) return ''
      try {
        new RegExp(re)
        return ''
      } catch (e) {
        return `正则语法错误：${(e as Error).message}`
      }
    },
    validate: () => validateDraft(fields.value),
    saveBlocked: () => validateDraft(fields.value).length > 0,
    serialize: () => serialize(fields.value),
    loadFromDefs(defs) {
      fields.value = defs.map(defToDraft)  // defToDraft 已产 formula 字段
      seq = fields.value.length
      resort()
      selected.value = -1
    },
  }
  return api
}

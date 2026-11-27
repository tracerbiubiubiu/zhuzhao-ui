import request from '@vea/request'
import type { TicketTypeFieldDef } from './index'
import { listAvailableTransitionsApi, STATUS_LABEL, transitionTicketApi } from './index'

type ObjectBody = Record<string, unknown>

interface DefinitionRef {
  type_code: string
  definition_version: string
  definition_hash: string
}

export type TicketDefinition =
  | { resolution: 'legacy' }
  | { resolution: 'degraded'; reference?: DefinitionRef }
  | { resolution: 'exact'; reference: DefinitionRef; revision: string; fields?: TicketTypeFieldDef[] }

export interface InstanceAction {
  id: string
  to: string
  title: string
  fields: { definition: TicketTypeFieldDef; required: boolean }[]
  commentRequired: boolean
  expectedRevision?: string
  definitionVersion?: string
}

export interface TransitionInstanceInput {
  id: string
  to: string
  expected_revision?: string
  definition_version?: string
  custom_data_patch?: Record<string, unknown>
  comment?: string
}

function isObject(value: unknown): value is ObjectBody {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807')
}

function readReference(value: unknown): DefinitionRef | undefined {
  if (!isObject(value)) return
  const { type_code, definition_version, definition_hash } = value
  if (isText(type_code) && isRevision(definition_version) && definition_version !== '0' && isText(definition_hash)) {
    return { type_code, definition_version, definition_hash }
  }
}

const fieldTypes = new Set<string>([
  'input', 'textarea', 'number', 'date', 'select', 'multi_select', 'tips', 'richtext', 'radio', 'rating', 'file',
])

function readFields(value: unknown): TicketTypeFieldDef[] {
  if (!Array.isArray(value)) throw new Error('绑定字段定义不完整，请刷新工单')
  const keys = new Set<string>()
  return value.map((field: unknown) => {
    if (!isObject(field) || !isText(field.field_key) || !isText(field.field_label)
      || typeof field.field_type !== 'string' || !fieldTypes.has(field.field_type) || keys.has(field.field_key)) {
      throw new Error('绑定字段定义无效或重复，请刷新工单')
    }
    keys.add(field.field_key)
    return field as unknown as TicketTypeFieldDef
  })
}

/** 已绑定工单只读其快照字段。无任何版本元数据时才沿用旧详情合同。 */
export function normalizeTicketDefinition(value: unknown): TicketDefinition {
  if (!isObject(value)) throw new Error('工单详情响应不完整，请重试')
  const { definition_resolution, definition_ref, revision, type_code } = value
  if (definition_resolution === undefined && definition_ref === undefined && revision === undefined) return { resolution: 'legacy' }
  const reference = readReference(definition_ref)
  if (definition_resolution === 'degraded') {
    return { resolution: 'degraded', reference: reference?.type_code === type_code ? reference : undefined }
  }
  if (definition_resolution !== 'exact' || !reference || reference.type_code !== type_code || !isRevision(revision)) {
    throw new Error('工单规则版本或修订号不完整，请刷新工单')
  }
  const fieldData = value.field_definitions ?? value.fields
  const fields = fieldData === undefined ? undefined : readFields(fieldData)
  return { resolution: 'exact', reference, revision, fields }
}

function normalizeAction(value: unknown, fields: Map<string, TicketTypeFieldDef>, definition: Extract<TicketDefinition, { resolution: 'exact' }>): InstanceAction {
  if (!isObject(value)) throw new Error('可用动作响应不完整，请刷新工单')
  const { action_id, to, label, expected_revision, definition_ref, collect_fields, comment_required } = value
  const reference = readReference(definition_ref)
  if (!isText(action_id) || !isText(to) || !isText(label) || !Array.isArray(collect_fields) || typeof comment_required !== 'boolean'
    || expected_revision !== definition.revision || !reference
    || reference.type_code !== definition.reference.type_code
    || reference.definition_version !== definition.reference.definition_version
    || reference.definition_hash !== definition.reference.definition_hash) {
    throw new Error('可用动作与当前工单规则或修订不一致，请刷新工单')
  }
  const boundFields = new Set<string>()
  return {
    id: action_id, to, title: label, commentRequired: comment_required,
    expectedRevision: definition.revision, definitionVersion: reference.definition_version,
    fields: collect_fields.map((field: unknown) => {
      if (!isObject(field) || !isText(field.key) || typeof field.required !== 'boolean' || boundFields.has(field.key)) {
        throw new Error('动作采集字段无效或重复，请刷新工单')
      }
      const fieldDefinition = fields.get(field.key)
      if (!fieldDefinition) throw new Error('动作缺少绑定字段定义，请刷新工单')
      if (fieldDefinition.field_type === 'tips' || fieldDefinition.field_meta?.formula) {
        throw new Error('动作包含不可填写字段，请联系管理员核查流程规则')
      }
      boundFields.add(field.key)
      return { definition: fieldDefinition, required: field.required }
    }),
  }
}

export async function getInstanceActionsApi(id: string, definition: TicketDefinition): Promise<{
  actions: InstanceAction[]
  capabilities?: { transfer: boolean; withdraw: boolean; withdrawCommentRequired?: boolean }
  fields: TicketTypeFieldDef[]
}> {
  if (definition.resolution === 'degraded') return { actions: [], fields: [] }
  if (definition.resolution === 'legacy') {
    const transitions = await listAvailableTransitionsApi(id, { _silentError: true })
    return {
      fields: [],
      actions: transitions.map(to => ({
        id: to, to, title: `→ ${STATUS_LABEL[to] ?? to}`, fields: [], commentRequired: false,
      })),
    }
  }
  const body: unknown = await request.get(`/api/v1/tickets/${id}/actions`, { _silentError: true })
  if (!isObject(body)) throw new Error('可用动作响应不完整，请刷新工单')
  const actionData = body.actions ?? body.available_actions
  if (!Array.isArray(actionData) || (body.ticket_id !== undefined && body.ticket_id !== id)
    || (body.revision !== undefined && body.revision !== definition.revision)) {
    throw new Error('可用动作与当前工单或修订不一致，请刷新工单')
  }
  const fieldData = body.field_definitions ?? body.fields
  const responseFields = fieldData === undefined ? [] : readFields(fieldData)
  const fields = new Map((definition.fields ?? []).map(field => [field.field_key, field]))
  for (const field of responseFields) fields.set(field.field_key, field)
  const actions = actionData.map(action => normalizeAction(action, fields, definition))
  if (new Set(actions.map(action => action.to)).size !== actions.length) {
    throw new Error('可用动作包含重复目标，请联系管理员核查流程规则')
  }
  const caps = body.capabilities
  const capabilities = body.ticket_id === id && body.revision === definition.revision && isObject(caps)
    && typeof caps.transfer === 'boolean' && typeof caps.withdraw === 'boolean'
    ? { transfer: caps.transfer, withdraw: caps.withdraw,
      ...(caps.withdraw_comment_required === true && { withdrawCommentRequired: true }) }
    : undefined
  return { actions, fields: [...fields.values()], capabilities }
}

export async function transitionInstanceApi(input: TransitionInstanceInput, operationId: string): Promise<void> {
  await transitionTicketApi(input, operationId)
}

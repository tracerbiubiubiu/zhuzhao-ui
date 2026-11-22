import request from '@vea/request'
import { createTicketApi, type CreateTicketInput, type TicketTypeFieldDef } from './index'

interface DefinitionReference {
  type_code: string
  definition_version: string
  definition_hash: string
}

export type PublishedTicketField = Pick<TicketTypeFieldDef,
  'field_key' | 'field_label' | 'field_type' | 'field_options' | 'field_meta' | 'required' | 'validate_regex'>

export interface PublishedTicketDefinition {
  type: { code: string; name: string; description?: string }
  fields: PublishedTicketField[]
  definition_ref: DefinitionReference
}

const fieldTypes = new Set<string>([
  'input', 'textarea', 'number', 'date', 'select', 'multi_select', 'tips', 'richtext', 'radio', 'rating', 'file',
] satisfies Array<PublishedTicketField['field_type']>)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPublishedField(value: unknown): value is PublishedTicketField {
  return isRecord(value)
    && typeof value.field_key === 'string' && value.field_key.trim().length > 0
    && typeof value.field_label === 'string' && value.field_label.trim().length > 0
    && typeof value.field_type === 'string' && fieldTypes.has(value.field_type)
    && typeof value.required === 'boolean'
    && (value.validate_regex === undefined || typeof value.validate_regex === 'string')
    && (value.field_meta == null || isRecord(value.field_meta))
}

/** 常规发起读取当前已发布快照。字段缺失与合法空数组的语义不同。 */
export async function getPublishedTicketDefinitionApi(code: string): Promise<PublishedTicketDefinition> {
  const data: unknown = await request.get(`/api/v1/ticket-types/${encodeURIComponent(code)}/published`, { _silentError: true })
  if (!isRecord(data)) throw new Error('已发布定义响应不完整')
  const { type, fields, definition_ref: ref } = data
  if (!isRecord(type) || type.code !== code || typeof type.name !== 'string' || !type.name.trim()
    || (type.description !== undefined && typeof type.description !== 'string') || type.is_active === false
    || !isRecord(ref) || ref.type_code !== code
    || typeof ref.definition_version !== 'string' || !/^[1-9]\d*$/.test(ref.definition_version)
    || typeof ref.definition_hash !== 'string' || !ref.definition_hash.trim()
    || !Array.isArray(fields) || !fields.every(isPublishedField)
    || new Set(fields.map(field => field.field_key)).size !== fields.length) {
    throw new Error('已发布定义响应不完整或不可用')
  }
  return {
    type: { code, name: type.name, ...(type.description !== undefined ? { description: type.description } : {}) },
    fields,
    definition_ref: { type_code: code, definition_version: ref.definition_version, definition_hash: ref.definition_hash },
  }
}

/** codegen 更新前，把建单预览引用集中在这里接入既有创建接口。 */
export function createTicketFromDefinitionApi(input: CreateTicketInput, definition: DefinitionReference) {
  const body = { ...input, definition_version: definition.definition_version, definition_hash: definition.definition_hash }
  return createTicketApi(body)
}

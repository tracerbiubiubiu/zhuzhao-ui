import request from '@vea/request'

export const definitionPublicationPermission = 'ticket:type:publish'

export interface PublicationDraftMetadata {
  draft_revision?: string
  current_published_version?: string | null
  definition_ref?: PublishedDefinitionRef | null
}

export interface PublicationTarget extends PublicationDraftMetadata {
  id: string
  code: string
  name: string
  version?: number
}

export interface PublishedDefinitionRef {
  type_code: string
  definition_version: string
  definition_hash: string
}

export interface PublicationBaseline {
  code: string
  expected_draft_revision: string
  expected_published_version: string | null
}

interface PublicationIssue {
  id?: string
  message: string
}

export interface PublicationPlan {
  plan_id: string
  plan_hash: string
  errors: PublicationIssue[]
  warnings: PublicationIssue[]
  diff?: unknown
}

export type PublishDefinitionInput = PublicationBaseline & Pick<PublicationPlan, 'plan_id' | 'plan_hash'> & {
  acknowledged_warning_ids?: string[]
}

export interface PublicationReceipt {
  changed: boolean
  definition_ref: PublishedDefinitionRef
}

function revision(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807')
}

export function readDraftRevision(row: Pick<PublicationTarget, 'draft_revision' | 'version'>): string | undefined {
  const draft = row.draft_revision ?? (Number.isSafeInteger(row.version) ? String(row.version) : undefined)
  return revision(draft) ? draft : undefined
}

export function readPublicationBaseline(row: PublicationDraftMetadata & { code: string; version?: number }): PublicationBaseline | null {
  const draft = readDraftRevision(row)
  const ref = row.definition_ref
  const referencedVersion = ref === null ? null : (ref?.type_code === row.code ? ref.definition_version : undefined)
  const published = row.current_published_version === null ? null : row.current_published_version ?? referencedVersion
  if (!draft || (published !== null && !revision(published))) return null
  return { code: row.code, expected_draft_revision: draft, expected_published_version: published }
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  throw new Error('规则发布响应格式不正确')
}

/** 发布预览必须区分草稿清单读取故障与目标确已不存在。 */
export async function listPublicationDraftsApi(): Promise<PublicationTarget[]> {
  const data: unknown = await request.get('/api/v1/ticket-types', { _silentError: true })
  const { types } = (data ?? {}) as { types?: unknown }
  if (!Array.isArray(types) || !types.every(row => row && typeof row.id === 'string' && typeof row.code === 'string' && typeof row.name === 'string')) {
    throw new Error('工单类型草稿清单读取失败')
  }
  return types as PublicationTarget[]
}

function readIssues(value: unknown): PublicationIssue[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('发布预览的检查结果格式不正确')
  return value.map((issue: unknown) => {
    if (typeof issue === 'string' && issue.trim()) return { message: issue }
    const { id, message } = record(issue)
    if (typeof message !== 'string' || !message.trim()) throw new Error('发布预览的检查结果格式不正确')
    return { id: typeof id === 'string' && id ? id : undefined, message }
  })
}

export async function planDefinitionPublicationApi(input: PublicationBaseline): Promise<PublicationPlan> {
  const data: unknown = await request.post('/api/v1/ticket-types/definitions/plan', input, { _silentError: true })
  const { plan_id, canonical_hash, changed, current_definition_ref, reference_revisions, warnings, errors } = record(data)
  const issues = readIssues(errors)
  const id = typeof plan_id === 'string' && plan_id.trim() ? plan_id : ''
  const hash = typeof canonical_hash === 'string' && canonical_hash.trim() ? canonical_hash : ''
  if ((!id || !hash) && !issues.length) throw new Error('发布预览缺少计划标识或摘要')
  return { plan_id: id, plan_hash: hash, diff: { changed, current_definition_ref, reference_revisions }, warnings: readIssues(warnings), errors: issues }
}

export async function publishDefinitionApi(input: PublishDefinitionInput, operationId: string): Promise<PublicationReceipt> {
  const { plan_hash, ...body } = input
  const data: unknown = await request.post('/api/v1/ticket-types/definitions/publish', { ...body, canonical_hash: plan_hash }, {
    _silentError: true, headers: { 'Idempotency-Key': operationId },
  })
  const { changed, definition_ref } = record(data)
  const { type_code, definition_version, definition_hash } = record(definition_ref)
  if (typeof changed !== 'boolean' || typeof type_code !== 'string' || type_code !== input.code || !revision(definition_version)
    || typeof definition_hash !== 'string' || !definition_hash.trim()) throw new Error('未能核实规则发布回执')
  return { changed, definition_ref: { type_code, definition_version, definition_hash } }
}

/** IAM 全量替换前的读取边界；坏载荷不可被解释为成功空集合。 */
export function assignmentRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('读取数据格式异常，请重试或联系管理员核查')
  return value as Record<string, unknown>
}

/** 接收侧保留安全整数兼容，大ID只允许精确十进制字符串。 */
export function assignmentId(value: unknown): string {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || (id.length > 19 || (id.length === 19 && id > '9223372036854775807'))) throw new Error('读取标识符格式异常，请重试或联系管理员核查')
  return id
}

export function assignmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('读取集合格式异常，请重试或联系管理员核查')
  const ids = value.map(assignmentId)
  if (new Set(ids).size !== ids.length) throw new Error('读取集合存在重复项，请重试或联系管理员核查')
  return ids
}

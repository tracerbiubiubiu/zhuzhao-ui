/** C05 保守分流：无响应、5xx、操作重复/冲突都不能证明安全写没有提交。 */
export function isDefiniteSecurityRejection(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: unknown } } })?.response
  return [400, 403, 422, 429].includes(response?.status ?? 0)
    && typeof response?.data?.code === 'number' && response.data.code !== 0
}

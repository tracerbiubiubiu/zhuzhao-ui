/** Descriptive only: registration and page permissions never grant maintenance authority. */
export function maintenanceGuidance(action: string | undefined): string | undefined {
  if (action !== 'audit_archive') return undefined
  return '任务管理权限不包含审计维护资格。未配置维护者时，人工归档默认拒绝；请联系运维开通独立维护资格。默认保留期由服务配置决定，临时调整须另行批准。'
}

export function taskMutationError(error: unknown, action: string | undefined, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { code?: number; message?: string } } })?.response
  const reason = response?.data?.message || fallback
  if (action !== 'audit_archive' || response?.status !== 403 || response.data?.code !== 10003) return reason
  return `${reason}。请联系运维核查独立维护资格、账号状态及批准条件；任务页面权限仍须满足。`
}

/**
 * 表单错误统一提取（走查反馈批 2026-10-28 收口——码面条件映射此前在
 * role/org/user/al-types/al-data 五页各自手写 response 三行抽取）。
 * 纪律（frontend-standard §错误码前端映射纪律）：本工具只做**形状抽取**；
 * 码面语义分档留在调用点——同码异义须场景守卫（参照 al/data 100008
 * 插入/编辑双语义案例）；文案优先后端透传，前端不造第二套文案体系。
 */
export interface ApiErrorBody {
  code?: number
  message?: string
}

/** 从 Axios 错误中提取统一信封 body（非 HTTP 错误返回空对象） */
export function apiErrorBody(err: unknown): ApiErrorBody {
  return (err as { response?: { data?: ApiErrorBody } })?.response?.data ?? {}
}

/** 后端 message 透传（可覆盖兜底文案） */
export function apiErrorMessage(err: unknown, fallback = '保存失败，请稍后重试'): string {
  return apiErrorBody(err).message ?? fallback
}

/** 冲突码族判定（zhuzhao 乐观锁 10006 / activelist CONFLICT 100008） */
export function isConflictCode(err: unknown): boolean {
  const code = apiErrorBody(err).code
  return code === 10006 || code === 100008
}

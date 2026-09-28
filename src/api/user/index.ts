/**
 * 用户自服务域 API（P4-W3 个人中心页，01 §6 契约）
 *
 * - profile/update 入参接 codegen 生成类型——**api 层切 generated 类型的首个范式**
 *   （AGENTS「随 W3 页面批接线」；契约漂移自此编译期报错）
 * - profile GET 响应侧 swag 为裸信封（data 无泛型），出参暂维持手写 UserProfile；
 *   后端补 @Success 泛型注解后同法切换
 */
import request from '@vea/request'
import type { components } from '@/api/__generated__/schema'
import type { UserProfile } from '@/store/modules/user'

export type UpdateProfileInput =
  components['schemas']['github_com_tracerbiubiubiu_zhuzhao_internal_model.UpdateProfileRequest']

/** 自服务资料更新（四字段 patch 语义——nil 保持现值） */
export async function updateProfileApi(input: UpdateProfileInput): Promise<void> {
  // _silentError：错误由表单内联展示（errorMsg），不走全局 toast
  await request.post('/api/v1/user/profile/update', input, { _silentError: true })
}

/** 拉当前用户资料（个人中心页编辑成功后刷新 store 用） */
export async function fetchProfileApi(): Promise<UserProfile> {
  const data = await request.get('/api/v1/user/profile', { _silentError: true })
  return data as unknown as UserProfile
}

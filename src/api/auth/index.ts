/**
 * 认证域 API（01 §6 契约）
 * - login: employee_no + password + device_id（必传）
 * - logout: 携带与登录相同的 device_id（W0 后必填）
 * - refresh: 走请求层单飞（不直接导出）
 */

import request from '@vea/request'
import { getDeviceId, type TokenPair } from '@/common/auth/tokenStorage'

export interface LoginParams {
  employee_no: string
  password: string
}

export async function loginApi(params: LoginParams): Promise<TokenPair> {
  const data = await request.post('/api/v1/auth/login', {
    ...params,
    device_id: getDeviceId(),
  })
  return data as unknown as TokenPair
}

export async function logoutApi(): Promise<void> {
  await request.post('/api/v1/auth/logout', {
    device_id: getDeviceId(),
  })
}

export async function updatePasswordApi(oldPassword: string, newPassword: string): Promise<TokenPair> {
  const data = await request.post('/api/v1/auth/password/update', {
    old_password: oldPassword,
    new_password: newPassword,
    device_id: getDeviceId(),
  })
  return data as unknown as TokenPair
}

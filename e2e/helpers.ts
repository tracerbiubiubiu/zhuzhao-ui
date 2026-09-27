import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本仓 "type": "module"（ESM）——无 __dirname，用 import.meta 定位
const here = fileURLToPath(new URL('.', import.meta.url))

/** 后端 API 基址（宿主进程 make dev） */
export const API_BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:33333'

/** globalSetup 产物：凭据与账号（幂等闭环后的终态） */
export interface E2EState {
  admin: { employeeNo: string; password: string }
  operator: { employeeNo: string; password: string }
  viewer: { employeeNo: string; password: string }
  /** S1 强制改密账号：password=被重置后的当前密码（must_change=true），newPassword=改密目标 */
  s1: { employeeNo: string; password: string; newPassword: string }
}

export const STATE_FILE = resolve(here, '.state.json')

export function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as E2EState
}

/** 统一信封（zhuzhao-utils/response）：{code, message, data, request_id}，code≠0 恒非 2xx */
export interface Envelope<T = unknown> {
  code: number
  message: string
  data: T
  request_id?: string
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
  must_change_password: boolean
}

interface ApiOptions {
  token?: string
  method?: string
  body?: unknown
}

/** 裸 API 调用（Node fetch；信封与 HTTP 状态原样透出，由调用方分流） */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<{ status: number; env: Envelope<T> | null }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const env = (await res.json().catch(() => null)) as Envelope<T> | null
  return { status: res.status, env }
}

export async function apiLogin(employeeNo: string, password: string, deviceId: string): Promise<{ status: number; env: Envelope<TokenPair> | null }> {
  return api<TokenPair>('/api/v1/auth/login', {
    method: 'POST',
    body: { employee_no: employeeNo, password, device_id: deviceId },
  })
}

/**
 * 风险域 HTTP 适配（B2 第 6 项——existing request 层落
 * list/detail/operation/create/assess/assign）
 *
 * 路由与权限绑定来自冻结源码 migrations/000089 menu_apis 种子（全部 `/api/v1` 下，
 * 仅 GET/POST；页面行 risk_list 仅挂 GET，写端点挂按钮行）：
 * - GET  /risk-items                       页面行（route:/risks）
 * - GET  /risk-items/:id                   页面行；不可见与不存在均 404
 * - GET  /risk-items/operations/:id        页面行——按原号查回写回执（受权核查）
 * - POST /risk-items/create                按钮 risk_create_btn
 * - POST /risk-items/assess                按钮 risk_assess_btn
 * - POST /risk-items/assign                按钮 risk_assign_btn
 *
 * report/history/ingest-receipts 本轮不接（上报属来源侧，历史/回执查询接口未列前端动作）。
 * 写命令按 Mutation 在 body 携带 operation_id + expected_revision（同号同参幂等）；
 * 断网/超时/5xx 属提交结果未知——页面按原号走 operations/:id 只读核查，不换号重做。
 */
import type { AxiosRequestConfig } from 'axios'
import request from '@vea/request'
import {
  toRiskPage, validateRiskDetail, validateRiskReceipt, validateCreateResult, validateAssessResult,
  validateAssignResult, type RiskAssignCommand, type RiskAssessCommand, type RiskAssessResult,
  type RiskCreateCommand, type RiskCreateResult, type RiskDetailDto, type RiskId, type RiskListParams,
  type RiskMutationResult, type RiskPageDto, type RiskPostBody, type RiskReader, type RiskReceiptDto, type RiskWriter,
} from './contracts'

type SilentConfig = Pick<AxiosRequestConfig, '_silentError' | 'signal'>

const silent = { _silentError: true } satisfies SilentConfig

export async function listRiskItemsApi(params: RiskListParams, signal?: AbortSignal): Promise<RiskPageDto> {
  const data: unknown = await request.get('/api/v1/risk-items', { params, ...silent, signal })
  return toRiskPage(data)
}

export async function getRiskItemApi(id: RiskId, signal?: AbortSignal): Promise<RiskDetailDto> {
  const data: unknown = await request.get(`/api/v1/risk-items/${id}`, { ...silent, signal })
  return validateRiskDetail(data, id)
}

/** 按原操作号受权核查写回执（提交结果未知时的只读出口；404=服务端尚未记录该号） */
export async function getRiskOperationApi(operationId: string, signal?: AbortSignal): Promise<RiskReceiptDto> {
  const data: unknown = await request.get(`/api/v1/risk-items/operations/${operationId}`, { ...silent, signal })
  return validateRiskReceipt(data)
}

/** 人工登记（expected_revision 恒传 "0"——新建无存量修订） */
export async function createRiskItemApi(input: RiskCreateCommand): Promise<RiskCreateResult> {
  const data: unknown = await request.post('/api/v1/risk-items/create', input satisfies RiskPostBody<'/api/v1/risk-items/create'>, silent)
  return validateCreateResult(data, input.operation_id)
}

/** 核实/定级/期限（允许 new|assessed；revision CAS 冲突 409） */
export async function assessRiskItemApi(input: RiskAssessCommand): Promise<RiskAssessResult> {
  const data: unknown = await request.post('/api/v1/risk-items/assess', input satisfies RiskPostBody<'/api/v1/risk-items/assess'>, silent)
  return validateAssessResult(data, input.operation_id)
}

/** 责任确认（主锚管理者；owner 不能仅凭可读自派） */
export async function assignRiskItemApi(input: RiskAssignCommand): Promise<RiskMutationResult> {
  const data: unknown = await request.post('/api/v1/risk-items/assign', input satisfies RiskPostBody<'/api/v1/risk-items/assign'>, silent)
  return validateAssignResult(data, input.operation_id)
}

/** 页面默认端口：生产走真实请求；测试经 props 注入替身（riskPage.test.ts 同型） */
export const riskHttpReader: RiskReader = {
  list: listRiskItemsApi,
  detail: getRiskItemApi,
  operation: getRiskOperationApi,
}

export const riskHttpWriter: RiskWriter = {
  create: createRiskItemApi,
  assess: assessRiskItemApi,
  assign: assignRiskItemApi,
}

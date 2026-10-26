<template>
  <div class="p-4">
    <el-card shadow="hover">
      <template #header><span class="font-semibold">消息管理（S6 通知中心）</span></template>
      <el-tabs v-model="activeTab">
        <!-- 模板管理（2026-10-26 通知面收口批：只读首版 → 编辑面） -->
        <el-tab-pane label="消息模板" name="templates">
          <div class="mb-2">
            <el-button v-permission="'notification:manage'" type="primary" size="small" data-testid="tpl-create" @click="openTplCreate">新建模板</el-button>
            <span class="text-xs text-gray-400 ml-2">占位符用双花括号包字段名（ticket.title / ticket.human_key / ticket.link）；种子模板（系统）只读</span>
          </div>
          <el-table ref="tplTable" :data="templates" v-loading="tplLoading" size="small" border>
            <el-table-column prop="code" label="标识" width="200" />
            <el-table-column prop="name" label="名称" width="180" />
            <el-table-column prop="biz_type" label="业务域" width="80" />
            <el-table-column prop="subject" label="主题模板" show-overflow-tooltip />
            <el-table-column prop="enabled" label="启用" width="60">
              <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag></template>
            </el-table-column>
            <el-table-column label="系统" width="60" align="center">
              <template #default="{ row }">{{ row.is_system ? '是' : '' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'notification:manage'" link type="primary" size="small" :disabled="row.is_system" @click="openTplEdit(row)">编辑</el-button>
                <el-button v-permission="'notification:manage'" link type="danger" size="small" :disabled="row.is_system" @click="onTplDelete(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 订阅规则（事件→模板路由；一事件一规则，改绑模板即在此换） -->
        <el-tab-pane label="订阅规则" name="rules">
          <div class="mb-2">
            <el-button v-permission="'notification:manage'" type="primary" size="small" data-testid="rule-create" @click="openRuleCreate">新建规则</el-button>
            <span class="text-xs text-gray-400 ml-2">规则=开关与默认模板；notify 动作可在 params.template 逐次覆盖</span>
          </div>
          <el-table ref="ruleTable" :data="rules" v-loading="ruleLoading" size="small" border>
            <el-table-column prop="biz_type" label="业务域" width="80" />
            <el-table-column prop="event_action" label="事件动作" width="200" />
            <el-table-column prop="template_code" label="使用模板" width="200" />
            <el-table-column prop="recipient_type" label="收件人类型" width="120" />
            <el-table-column prop="fixed_recipients" label="固定收件人" width="140" show-overflow-tooltip />
            <el-table-column prop="enabled" label="启用" width="60">
              <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'notification:manage'" link type="primary" size="small" @click="openRuleEdit(row)">编辑</el-button>
                <el-button v-permission="'notification:manage'" link type="danger" size="small" @click="onRuleDelete(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 发送记录 -->
        <el-tab-pane label="发送记录" name="logs">
          <el-table ref="logTable" :data="logs" v-loading="logLoading" size="small" border>
            <el-table-column prop="template_code" label="模板" width="200" />
            <el-table-column prop="biz_id" label="业务 ID" width="80" />
            <el-table-column prop="recipients" label="收件人" width="120" />
            <el-table-column prop="subject" label="主题" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="70">
              <template #default="{ row }"><el-tag :type="row.status === 'sent' ? 'success' : 'danger'" size="small">{{ row.status === 'sent' ? '已发' : '失败' }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="170">
              <template #default="{ row }">{{ new Date(row.created_at).toLocaleString('zh-CN', { hour12: false }) }}</template>
            </el-table-column>
          </el-table>
          <div v-if="logTotal > logPageSize" class="mt-2 text-center">
            <el-pagination v-model:current-page="logPage" :page-size="logPageSize" :total="logTotal" layout="prev, pager, next" @current-change="fetchLogs" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 模板编辑对话框（code 建后不可改；is_system 行不可入） -->
    <el-dialog v-model="tplDialog.visible" :title="tplDialog.isCreate ? '新建消息模板' : `编辑模板 ${tplForm.code}`" width="640px">
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="标识" required>
          <el-input v-model="tplForm.code" :disabled="!tplDialog.isCreate" placeholder="如 ticket_assigned_v2" maxlength="64" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="tplForm.name" placeholder="模板名称" maxlength="128" />
        </el-form-item>
        <el-form-item label="业务域" required>
          <el-select v-model="tplForm.biz_type" class="!w-[200px]">
            <el-option label="工单 ticket" value="ticket" />
            <el-option label="运维 ops" value="ops" />
          </el-select>
        </el-form-item>
        <el-form-item label="渠道">
          <el-select v-model="tplForm.channel" class="!w-[200px]" disabled>
            <el-option label="企业统一消息平台 uip" value="uip" />
          </el-select>
        </el-form-item>
        <el-form-item label="主题" required>
          <el-input v-model="tplForm.subject" :placeholder="'通知主题，可含 {{ticket.title}} 等占位'" maxlength="255" />
        </el-form-item>
        <el-form-item label="正文" required>
          <el-input v-model="tplForm.body" type="textarea" :rows="5" placeholder="通知正文，占位符同主题" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="tplForm.enabled" />
        </el-form-item>
      </el-form>
      <el-alert v-if="tplDialog.error" :title="tplDialog.error" type="error" show-icon :closable="false" />
      <template #footer>
        <el-button @click="tplDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="tplDialog.loading" @click="submitTpl">{{ tplDialog.isCreate ? '创建' : '保存' }}</el-button>
      </template>
    </el-dialog>

    <!-- 规则编辑对话框（upsert：biz_type+event_action 唯一，同键保存=改绑模板/收件人） -->
    <el-dialog v-model="ruleDialog.visible" :title="ruleDialog.isCreate ? '新建订阅规则' : `编辑规则 ${ruleForm.biz_type}:${ruleForm.event_action}`" width="560px">
      <el-form label-width="100px" @submit.prevent>
        <el-form-item label="业务域" required>
          <el-select v-model="ruleForm.biz_type" class="!w-full" :disabled="!ruleDialog.isCreate">
            <el-option label="工单 ticket" value="ticket" />
            <el-option label="运维 ops" value="ops" />
          </el-select>
        </el-form-item>
        <el-form-item label="事件动作" required>
          <el-select v-model="ruleForm.event_action" class="!w-full" filterable :disabled="!ruleDialog.isCreate" placeholder="选择事件">
            <el-option v-for="e in EVENT_OPTIONS" :key="e.value" :label="`${e.value}（${e.label}）`" :value="e.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="使用模板" required>
          <el-select v-model="ruleForm.template_code" class="!w-full" filterable placeholder="选择模板">
            <el-option v-for="t in templates" :key="t.code" :label="`${t.code}（${t.name}）`" :value="t.code" :disabled="!t.enabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="收件人类型" required>
          <el-select v-model="ruleForm.recipient_type" class="!w-full">
            <el-option label="处理人 assignee" value="assignee" />
            <el-option label="创建人 creator" value="creator" />
            <el-option label="抄送人 cc" value="cc" />
            <el-option label="固定收件人 fixed" value="fixed" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="ruleForm.recipient_type === 'fixed'" label="固定收件人">
          <el-input v-model="ruleForm.fixed_recipients" placeholder="用户 ID 逗号分隔，如 12,34" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
      </el-form>
      <el-alert v-if="ruleDialog.error" :title="ruleDialog.error" type="error" show-icon :closable="false" />
      <template #footer>
        <el-button @click="ruleDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="ruleDialog.loading" @click="submitRule">{{ ruleDialog.isCreate ? '创建' : '保存' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * S6 消息管理页（B6-3 模板 + B6-6 规则/发送记录——06 号 §4/§5.4 管理面）。
 * 2026-10-26 通知面收口批：只读首版 → 模板/规则编辑面（后端端点随 B6-6 既有，本页补 UI）。
 * 规则语义：biz_type+event_action 唯一（一事件一规则）——同键保存=改绑模板/收件人；规则=开关与默认模板，
 * notify 动作可在 params.template 逐次覆盖（000079 起 ticket.action_notify 有种子默认路由）。
 */
import { reactive, ref, onMounted } from 'vue'
import { useTableFit } from '@vea/hooks'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput,
  ElMessage, ElMessageBox, ElOption, ElPagination, ElSelect, ElSwitch,
  ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag,
} from 'element-plus'
import request from '@/common/request'

// 顶层菜单页路由名=`${code}_page`（permissionRoutes）；原 'SystemNotification' 与路由名不符致 keep-alive 恒不命中
defineOptions({ name: 'system_notification_page' })

interface TemplateRow {
  code: string
  name: string
  channel: string
  biz_type: string
  subject: string
  body: string
  enabled: boolean
  is_system?: boolean
  version?: number
}
interface RuleRow {
  id: string
  biz_type: string
  event_action: string
  template_code: string
  recipient_type: string
  fixed_recipients?: string
  enabled: boolean
  version?: number
}

/** 事件词表——与后端 message_admin_service.validEventActions 同源（手工同步，改一头改两头） */
const EVENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ticket.created', label: '工单创建' },
  { value: 'ticket.assigned', label: '工单分派' },
  { value: 'ticket.closed', label: '工单关闭' },
  { value: 'ticket.updated', label: '工单更新' },
  { value: 'ticket.commented', label: '工单评论' },
  { value: 'ticket.cc_added', label: '加入抄送' },
  { value: 'ticket.timeout', label: '节点超时催办' },
  { value: 'ticket.deadline', label: 'SLA 截止' },
  { value: 'ticket.transitioned', label: '状态转换' },
  { value: 'ticket.dispatch_missed', label: '自动分派未命中' },
  { value: 'ticket.action_notify', label: 'notify 动作（流程提醒）' },
  { value: 'ops.cron_failed', label: '定时任务失败（ops）' },
  { value: 'ops.action_failed', label: '流程动作失败（ops）' },
]

const activeTab = ref('templates')
const templates = ref<TemplateRow[]>([])
const rules = ref<RuleRow[]>([])
const logs = ref<Record<string, unknown>[]>([])
const tplLoading = ref(false)
const ruleLoading = ref(false)
const logLoading = ref(false)
const logPage = ref(1)
const logPageSize = 20
const logTotal = ref(0)

const tplTable = ref()
const ruleTable = ref()
const logTable = ref()
useTableFit(tplTable, () => templates.value)
useTableFit(ruleTable, () => rules.value)
useTableFit(logTable, () => logs.value)

async function fetchTemplates() {
  tplLoading.value = true
  try {
    const data = await request.get('/api/v1/message-templates', { params: { page: 1, page_size: 100 } })
    templates.value = ((data as unknown as { list?: TemplateRow[] })?.list ?? [])
  } catch { /* 403=无权限 */ } finally { tplLoading.value = false }
}

async function fetchRules() {
  ruleLoading.value = true
  try {
    const data = await request.get('/api/v1/message-rules')
    rules.value = (data as unknown as RuleRow[]) ?? []
  } catch { /* 403=无权限 */ } finally { ruleLoading.value = false }
}

async function fetchLogs() {
  logLoading.value = true
  try {
    const data = await request.get('/api/v1/message-logs', { params: { page: logPage.value, page_size: logPageSize } })
    const resp = data as unknown as { list?: Record<string, unknown>[]; total?: number }
    logs.value = resp?.list ?? []
    logTotal.value = resp?.total ?? 0
  } catch { /* 403=无权限 */ } finally { logLoading.value = false }
}

// ─── 模板编辑 ───
const tplDialog = reactive({ visible: false, loading: false, error: '', isCreate: true })
const tplForm = reactive<TemplateRow>({ code: '', name: '', channel: 'uip', biz_type: 'ticket', subject: '', body: '', enabled: true })

function openTplCreate() {
  Object.assign(tplForm, { code: '', name: '', channel: 'uip', biz_type: 'ticket', subject: '', body: '', enabled: true })
  tplDialog.error = ''
  tplDialog.isCreate = true
  tplDialog.visible = true
}
function openTplEdit(row: TemplateRow) {
  Object.assign(tplForm, row)
  tplDialog.error = ''
  tplDialog.isCreate = false
  tplDialog.visible = true
}
async function submitTpl() {
  if (!tplForm.code || !tplForm.name || !tplForm.subject || !tplForm.body) {
    tplDialog.error = 'code/名称/主题/正文均必填'
    return
  }
  tplDialog.loading = true
  tplDialog.error = ''
  try {
    // 同规则：model.ID 为 json:",string"——payload 不带 id（create 无、update 按 code 定位）
    const { ...body } = tplForm
    delete (body as Record<string, unknown>).id
    if (tplDialog.isCreate) {
      await request.post('/api/v1/message-templates', body, { _silentError: true })
    } else {
      await request.post('/api/v1/message-templates/update', body, { _silentError: true })
    }
    tplDialog.visible = false
    ElMessage.success(tplDialog.isCreate ? '模板已创建' : '模板已保存')
    await fetchTemplates()
  } catch (e: unknown) {
    tplDialog.error = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败'
  } finally { tplDialog.loading = false }
}
async function onTplDelete(row: TemplateRow) {
  try {
    await ElMessageBox.confirm(`确认删除模板「${row.name}（${row.code}）」？引用它的规则将拒发并 Warn。`, '危险操作',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
  } catch { return }
  try {
    await request.post('/api/v1/message-templates/delete', { code: row.code }, { _silentError: true })
    ElMessage.success('已删除')
    await fetchTemplates()
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败')
  }
}

// ─── 规则编辑（upsert：同 biz_type+event_action 保存=改绑） ───
const ruleDialog = reactive({ visible: false, loading: false, error: '', isCreate: true })
const ruleForm = reactive<RuleRow>({ id: '', biz_type: 'ticket', event_action: '', template_code: '', recipient_type: 'assignee', fixed_recipients: '', enabled: true })

function openRuleCreate() {
  Object.assign(ruleForm, { id: '', biz_type: 'ticket', event_action: '', template_code: '', recipient_type: 'assignee', fixed_recipients: '', enabled: true, version: undefined })
  ruleDialog.error = ''
  ruleDialog.isCreate = true
  ruleDialog.visible = true
}
function openRuleEdit(row: RuleRow) {
  Object.assign(ruleForm, row)
  ruleDialog.error = ''
  ruleDialog.isCreate = false
  ruleDialog.visible = true
}
async function submitRule() {
  if (!ruleForm.event_action || !ruleForm.template_code) {
    ruleDialog.error = '事件动作与模板必填'
    return
  }
  ruleDialog.loading = true
  ruleDialog.error = ''
  try {
    // upsert 按 biz_type+event_action 定位（同键保存=改绑）——id 不参与；且 model.ID 为 json:",string"，
    // 空串会 ShouldBindJSON 失败落「参数错误」，故载荷剔 id
    const body: Record<string, unknown> = { ...ruleForm }
    delete body.id
    await request.post('/api/v1/message-rules', body, { _silentError: true })
    ruleDialog.visible = false
    ElMessage.success(ruleDialog.isCreate ? '规则已创建' : '规则已保存')
    await fetchRules()
  } catch (e: unknown) {
    ruleDialog.error = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败'
  } finally { ruleDialog.loading = false }
}
async function onRuleDelete(row: RuleRow) {
  try {
    await ElMessageBox.confirm(`确认删除规则 ${row.biz_type}:${row.event_action}？删除后该事件不再发通知。`, '危险操作',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
  } catch { return }
  try {
    await request.post('/api/v1/message-rules/delete', { id: row.id }, { _silentError: true })
    ElMessage.success('已删除')
    await fetchRules()
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败')
  }
}

onMounted(() => { fetchTemplates(); fetchRules(); fetchLogs() })
</script>

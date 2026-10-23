<template>
  <div class="p-4">
    <el-card shadow="hover">
      <template #header><span class="font-semibold">消息管理（S6 通知中心）</span></template>
      <el-tabs v-model="activeTab">
        <!-- 模板管理 -->
        <el-tab-pane label="消息模板" name="templates">
          <el-table ref="tplTable" :data="templates" v-loading="tplLoading" size="small" border>
            <el-table-column prop="code" label="标识" width="200" />
            <el-table-column prop="name" label="名称" width="180" />
            <el-table-column prop="biz_type" label="业务域" width="80" />
            <el-table-column prop="subject" label="主题模板" show-overflow-tooltip />
            <el-table-column prop="enabled" label="启用" width="60">
              <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 订阅规则 -->
        <el-tab-pane label="订阅规则" name="rules">
          <el-table ref="ruleTable" :data="rules" v-loading="ruleLoading" size="small" border>
            <el-table-column prop="biz_type" label="业务域" width="80" />
            <el-table-column prop="event_action" label="事件动作" width="180" />
            <el-table-column prop="template_code" label="使用模板" width="200" />
            <el-table-column prop="recipient_type" label="收件人类型" width="120" />
            <el-table-column prop="enabled" label="启用" width="60">
              <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag></template>
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
  </div>
</template>

<script setup lang="ts">
/**
 * S6 消息管理页（B6-3 模板 + B6-6 规则/发送记录——06 号 §4/§5.4 管理面）。
 * 只读首版——CRUD 编辑/规则管理/偏好设置随 UI 打磨批扩。
 */
import { ref, onMounted } from 'vue'
import { useTableFit } from '@vea/hooks'
import { ElCard, ElPagination, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus'
import request from '@/common/request'

defineOptions({ name: 'SystemNotification' })

const activeTab = ref('templates')
const templates = ref<Record<string, unknown>[]>([])
const rules = ref<Record<string, unknown>[]>([])
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
    const data = await request.get('/api/v1/message-templates', { params: { page: 1, page_size: 50 } })
    templates.value = ((data as unknown as { list?: Record<string, unknown>[] })?.list ?? [])
  } catch { /* 403=无权限 */ } finally { tplLoading.value = false }
}

async function fetchRules() {
  ruleLoading.value = true
  try {
    const data = await request.get('/api/v1/message-rules')
    rules.value = (data as unknown as Record<string, unknown>[]) ?? []
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

onMounted(() => { fetchTemplates(); fetchRules(); fetchLogs() })
</script>

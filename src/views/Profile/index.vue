<script setup lang="ts">
/**
 * 个人中心（profile 自服务，01 §8-W2→W3 首批补交付）
 *
 * - 资料展示（用户名/工号只读——后端自服务不可改）+ 四字段编辑
 *   （real_name/email/phone/avatar——patch 语义，对应 UpdateProfileRequest）
 * - 自愿改密入口 → 强制改密页（共用同一页面流程：旧密码验证+轮换）
 * - 编辑成功后重拉 /user/profile 刷新 store（侧栏头像等消费点同步）
 */

import { reactive, ref, computed } from 'vue'
import {
  ElCard, ElForm, ElFormItem, ElInput, ElButton, ElDescriptions,
  ElDescriptionsItem, ElAlert, ElTag, ElAvatar, ElMessage, ElMessageBox,
  ElTable, ElTableColumn, ElDialog, ElInputNumber,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/modules/user'
import { updateProfileApi, fetchProfileApi } from '@/api/user'
import { createPatApi, listPatsApi, revokePatApi, type PatRow } from '@/api/user/pat'

// keep-alive 契约：name=路由名（静态补充路由 §3.2④，tagsView.cachedViews 存路由名）
defineOptions({ name: 'Profile' })

const router = useRouter()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({
  real_name: userStore.profile?.real_name ?? '',
  email: userStore.profile?.email ?? '',
  phone: userStore.profile?.phone ?? '',
  avatar: userStore.profile?.avatar ?? '',
})

const rules: FormRules = {
  real_name: [{ max: 50, message: '姓名不超过 50 字', trigger: 'blur' }],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
  phone: [{ max: 20, message: '手机号不超过 20 位', trigger: 'blur' }],
}

const canSubmit = computed(() => !loading.value)

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorMsg.value = ''
  try {
    await updateProfileApi({ ...form })
    // 重拉资料刷新 store（头像等全局消费点同步）
    userStore.profile = await fetchProfileApi()
    ElMessage.success('资料已更新')
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    errorMsg.value = resp?.message ?? '保存失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

// ─── P4-6 PAT（个人 API 凭据——脚本/CI 调用）───
const pats = ref<PatRow[]>([])
const patLoading = ref(false)
const patVisible = ref(false)
const patSaving = ref(false)
const patError = ref('')
const patForm = reactive({ name: '', expires_days: 90 })
/** 明文仅此一次——弹窗展示+复制，关闭即弃 */
const createdSecret = ref('')
const createdName = ref('')

async function fetchPats() {
  patLoading.value = true
  try {
    pats.value = await listPatsApi()
  } finally {
    patLoading.value = false
  }
}
fetchPats()

function openPatCreate() {
  patError.value = ''
  createdSecret.value = ''
  Object.assign(patForm, { name: '', expires_days: 90 })
  patVisible.value = true
}

async function submitPat() {
  if (!patForm.name.trim()) {
    patError.value = '请输入凭据名称'
    return
  }
  patSaving.value = true
  patError.value = ''
  try {
    const { pat, secret } = await createPatApi({ name: patForm.name.trim(), expires_days: patForm.expires_days })
    createdSecret.value = secret
    createdName.value = pat.name
    fetchPats()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    patError.value = resp?.message ?? '创建失败'
  } finally {
    patSaving.value = false
  }
}

async function onRevokePat(row: PatRow) {
  try {
    await ElMessageBox.confirm(`吊销「${row.name}」后使用该凭据的脚本将立即 401。确认？`, '吊销凭据', {
      type: 'warning', confirmButtonText: '吊销', cancelButtonText: '取消',
    })
  } catch { return }
  try {
    await revokePatApi(row.id)
    ElMessage.success('已吊销')
    fetchPats()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '吊销失败')
  }
}

function patStatus(row: PatRow): { label: string; type: 'success' | 'danger' | 'info' } {
  if (row.revoked_at) return { label: '已吊销', type: 'danger' }
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { label: '已过期', type: 'info' }
  return { label: '生效中', type: 'success' }
}

function copySecret() {
  navigator.clipboard?.writeText(createdSecret.value)
  ElMessage.success('已复制')
}

function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="p-4 max-w-[720px] mx-auto">
    <el-card shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">基本信息</span></template>
      <div class="flex items-center gap-4 mb-2">
        <el-avatar :size="64" :src="userStore.profile?.avatar || undefined">
          {{ userStore.profile?.username?.slice(0, 1)?.toUpperCase() }}
        </el-avatar>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="用户名">{{ userStore.profile?.username ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="工号">{{ userStore.profile?.employee_no ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="账号状态">
            <el-tag v-if="userStore.mustChangePassword" type="warning" size="small">待改密</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="密码">
            <el-button link type="primary" @click="router.push('/change-password')">修改密码</el-button>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </el-card>

    <el-card shadow="hover">
      <template #header><span class="font-semibold">编辑资料</span></template>
      <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon class="mb-4" :closable="false" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="姓名" prop="real_name">
          <el-input v-model="form.real_name" placeholder="真实姓名" maxlength="50" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="name@example.com" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" placeholder="手机号" maxlength="20" />
        </el-form-item>
        <el-form-item label="头像" prop="avatar">
          <el-input v-model="form.avatar" placeholder="头像图片 URL" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" :disabled="!canSubmit" @click="handleSubmit">
            保存
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- P4-6 个人 API 凭据（PAT——脚本/CI 调用；明文仅创建时一次） -->
    <el-card shadow="hover" class="mt-4">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">API 凭据（PAT）</span>
          <el-button type="primary" size="small" @click="openPatCreate">新建凭据</el-button>
        </div>
      </template>
      <el-alert
        title="用于脚本/CI 等非交互调用：Authorization: Bearer zpat_…（等效登录态）。明文仅创建时展示一次，请立即保存。"
        type="info" show-icon :closable="false" class="mb-3"
      />
      <el-table :data="pats" v-loading="patLoading" row-key="id">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="patStatus(row as PatRow).type" size="small">{{ patStatus(row as PatRow).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="过期时间" width="170">
          <template #default="{ row }">{{ (row as PatRow).expires_at ? formatTime((row as PatRow).expires_at) : '永不过期' }}</template>
        </el-table-column>
        <el-table-column label="最近使用" width="170">
          <template #default="{ row }">{{ formatTime((row as PatRow).last_used_at) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime((row as PatRow).created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button
              link type="danger" size="small" :disabled="!!(row as PatRow).revoked_at"
              @click="onRevokePat(row as PatRow)"
            >吊销</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 创建/明文一次弹窗 -->
      <el-dialog v-model="patVisible" :title="createdSecret ? '凭据已创建——仅此一次' : '新建 API 凭据'" width="520px">
        <template v-if="!createdSecret">
          <el-input v-model="patForm.name" placeholder="凭据名称（如 CI 部署脚本）" class="mb-3" />
          <div class="flex items-center gap-2 mb-3">
            <span class="text-sm text-gray-500">有效期（天）</span>
            <el-input-number v-model="patForm.expires_days" :min="0" :max="3650" />
            <span class="text-xs text-gray-400">0=永不过期</span>
          </div>
          <el-alert v-if="patError" :title="patError" type="error" show-icon :closable="false" />
        </template>
        <template v-else>
          <el-alert title="请立即复制保存——关闭后无法再次查看（服务端只存哈希）" type="warning" show-icon :closable="false" class="mb-3" />
          <pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded select-all">{{ createdSecret }}</pre>
        </template>
        <template #footer>
          <template v-if="!createdSecret">
            <el-button @click="patVisible = false">取消</el-button>
            <el-button type="primary" :loading="patSaving" @click="submitPat">创建</el-button>
          </template>
          <template v-else>
            <el-button @click="copySecret">复制</el-button>
            <el-button type="primary" @click="patVisible = false">我已保存，关闭</el-button>
          </template>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

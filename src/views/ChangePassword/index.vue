<script setup lang="ts">
/**
 * 强制改密页（01 §3.1 步 4 / §6——首登 must_change_password=true 唯一可达功能页）
 *
 * - 旧密码验证 + 新密码（min=8）+ 确认新密码
 * - 成功后 TokenPair 轮换（后端返回新 AT/RT——整体替换，旧 AT 已进黑名单）
 * - 携带 device_id（改密漏传会落 "default" 错槽互踢）
 */

import { ref, computed, reactive } from 'vue'
import { ElForm, ElFormItem, ElInput, ElButton, ElCard, ElAlert } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/store/modules/user'
import { isSafeRedirect } from '@/router/sessionError'
import { getDeviceId, getSessionGeneration } from '@/common/auth/tokenStorage'
import { createPasswordSubmission } from './passwordSubmission'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const formRef = ref<FormInstance>()
const submission = createPasswordSubmission({
  // 首登可能没有profile；固定同一设备范围，不能因后来加载profile而遗失待核查K。
  // 自助核查契约冻结前，未核实操作保守阻止同设备的新改密。
  scope: getDeviceId(),
  storage: { getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) },
  generation: getSessionGeneration,
  newKey: () => crypto.randomUUID(),
  change: (oldPassword, newPassword, key) => userStore.changePassword(oldPassword, newPassword, key),
})
const submissionState = submission.state
const validating = ref(false)
const loading = computed(() => validating.value || submissionState.busy)

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少 8 位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== form.newPassword) callback(new Error('两次输入不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

const canSubmit = computed(() =>
  form.oldPassword && form.newPassword && form.confirmPassword && !loading.value && !submission.blocked()
)

async function handleSubmit() {
  if (!canSubmit.value) return
  validating.value = true
  const generation = getSessionGeneration()
  try {
    const valid = await formRef.value?.validate().catch(() => false)
    if (!valid || generation !== getSessionGeneration()) return
    if (!await submission.submit(form.oldPassword, form.newPassword)) return
    // 改密成功 → 回跳原目标（TokenPair 已轮换+mustChangePassword 已清）。
    // 19 项线 P3-9：redirect 回跳（站内校验拒 //——与 SessionError 共用 isSafeRedirect）；
    // 无 redirect（自愿改密入口）落首页
    router.push(isSafeRedirect(route.query.redirect) ? route.query.redirect : '/')
  } finally {
    validating.value = false
    if (submissionState.operationId) Object.assign(form, { oldPassword: '', newPassword: '', confirmPassword: '' })
  }
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-[#f5f7fa]">
    <el-card class="w-[420px]" shadow="hover">
      <template #header>
        <div class="text-center">
          <h3 class="text-lg font-semibold">修改密码</h3>
          <p class="text-sm text-gray-500 mt-1">首次登录须修改初始密码后才能进入系统</p>
        </div>
      </template>
      <el-alert v-if="submissionState.message" :title="submissionState.message" type="error" show-icon class="mb-4" :closable="false" />
      <p v-if="submissionState.operationId" class="text-sm break-all mb-4">原操作号：{{ submissionState.operationId }}</p>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large">
        <el-form-item label="当前密码" prop="oldPassword">
          <!-- 同 LoginForm #7：字符串 prefix-icon 未注册不渲染——#prefix 插槽 + 全局 Icon -->
          <el-input v-model="form.oldPassword" type="password" show-password placeholder="请输入当前密码">
            <template #prefix><Icon icon="mdi:lock-outline" /></template>
          </el-input>
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password placeholder="至少 8 位">
            <template #prefix><Icon icon="mdi:key-outline" /></template>
          </el-input>
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password placeholder="再次输入新密码" @keyup.enter="handleSubmit">
            <template #prefix><Icon icon="mdi:key-outline" /></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="w-[100%]" :loading="loading" :disabled="!canSubmit" @click="handleSubmit">
            确认修改
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

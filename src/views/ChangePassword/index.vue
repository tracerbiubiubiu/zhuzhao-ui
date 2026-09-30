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
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/modules/user'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMsg = ref('')

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
  form.oldPassword && form.newPassword && form.confirmPassword && !loading.value
)

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorMsg.value = ''
  try {
    await userStore.changePassword(form.oldPassword, form.newPassword)
    // 改密成功 → 跳首页（TokenPair 已轮换+mustChangePassword 已清）
    router.push('/')
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    errorMsg.value = resp?.message ?? '修改密码失败，请稍后重试'
  } finally {
    loading.value = false
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
      <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon class="mb-4" :closable="false" />
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

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
  ElDescriptionsItem, ElAlert, ElTag, ElAvatar, ElMessage,
} from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/modules/user'
import { updateProfileApi, fetchProfileApi } from '@/api/user'

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
  </div>
</template>

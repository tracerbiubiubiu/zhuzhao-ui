<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElForm, ElFormItem, ElInput, ElButton } from 'element-plus'
  import { useRouter } from 'vue-router'
  import { required, useForm } from '@vea/hooks'
  import type { LoginParams } from '@/api/auth'
  import { getCaptchaApi } from '@/api/auth'
  import { useI18n } from 'vue-i18n'
  import { useUserStore } from '@/store/modules/user'
  import { ensureDynamicRoutes } from '@/permission'

  const userStore = useUserStore()
  const { currentRoute, push } = useRouter()
  const { t } = useI18n()

  // zhuzhao 契约：employee_no（工号）登录，非 username
  const { state, actions } = useForm<LoginParams>({
    initialValues: { employee_no: '', password: '' },
    rules: {
      employee_no: required(() => '请输入工号'),
      password: required(() => '请输入密码'),
    },
  })
  const values = computed(() => state.values.value)
  const errors = computed(() => state.errors.value)
  const submitting = computed(() => state.submitting.value)
  const loginError = ref('')

  // P4-7 验证码插槽（01 §6 预留位）：后端 enabled 时显示——关闭态布局零变化
  const captchaEnabled = ref(false)
  const captchaImage = ref('')
  const captchaId = ref('')
  const captchaCode = ref('')
  const refreshCaptcha = async () => {
    try {
      const res = await getCaptchaApi()
      captchaEnabled.value = !!res.enabled
      captchaImage.value = res.image ?? ''
      captchaId.value = res.captcha_id ?? ''
      captchaCode.value = ''
    } catch { /* 拉取失败不阻塞登录（关闭态/降级——提交时后端把关） */ }
  }
  refreshCaptcha()
  const redirect = computed(() => {
    const value = currentRoute.value.query.redirect
    // 站内 redirect 校验（防开放重定向）
    if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value
    return '/'
  })

  const doLogin = async () => {
    loginError.value = ''
    try {
      await userStore.login({
        employee_no: values.value.employee_no,
        password: values.value.password,
        ...(captchaEnabled.value ? { captcha_id: captchaId.value, captcha: captchaCode.value } : {}),
      })
      // 加载 session + 动态路由（守卫 §3.1 步 3 提前执行）
      await userStore.loadSession()
      await ensureDynamicRoutes()
      // must_change_password → 强制跳改密页
      if (userStore.mustChangePassword) {
        push('/change-password')
        return
      }
      push(redirect.value)
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
      loginError.value = resp?.message ?? '登录失败，请稍后重试'
      // 验证码一次性（GETDEL）——失败即焚，自动换图
      if (captchaEnabled.value) refreshCaptcha()
    }
  }

  const submit = () => {
    // 走 useForm.submit 链（内部 validate→handler）——修复绕过校验
    actions.submit(async () => {
      await doLogin()
    })
  }
</script>

<template>
  <el-form :model="values" label-position="top" size="large" @submit.prevent="submit">
    <el-form-item :error="Array.isArray(errors.employee_no) ? errors.employee_no[0] : errors.employee_no">
      <el-input
        v-model="values.employee_no"
        :placeholder="'工号'"
        prefix-icon="mdi:account-outline"
        autocomplete="username"
      />
    </el-form-item>
    <el-form-item :error="Array.isArray(errors.password) ? errors.password[0] : errors.password">
      <el-input
        v-model="values.password"
        type="password"
        :placeholder="'密码'"
        prefix-icon="mdi:lock-outline"
        show-password
        autocomplete="current-password"
        @keyup.enter="submit"
      />
    </el-form-item>
    <!-- P4-7 验证码插槽（后端 enabled 才渲染——关闭态零变化） -->
    <el-form-item v-if="captchaEnabled">
      <div class="flex w-full gap-2">
        <el-input v-model="captchaCode" placeholder="验证码" class="flex-1" @keyup.enter="submit" />
        <img
          v-if="captchaImage" :src="captchaImage" alt="验证码"
          class="h-10 cursor-pointer rounded border border-gray-200"
          title="点击刷新" @click="refreshCaptcha"
        >
      </div>
    </el-form-item>
    <el-form-item v-if="loginError" :error="loginError" />
    <el-form-item>
      <el-button type="primary" class="w-[100%]" :loading="submitting" @click="submit">
        {{ t('common.login') }}
      </el-button>
    </el-form-item>
  </el-form>
</template>

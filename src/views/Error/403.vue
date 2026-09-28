<script setup lang="ts">
  import { ElButton } from 'element-plus'
  import { useI18n } from 'vue-i18n'
  import { useRouter } from 'vue-router'

  // 403 无权限页（§3.2⑤ constantRoutes）——守卫 route:{path} 校验未过跳入；
  // 与 404 分工：路由存在但无码=403，路由不存在=catch-all 404
  const { t } = useI18n()
  const { push } = useRouter()

  const backHome = () => {
    push('/')
  }
</script>

<template>
  <div class="flex justify-center pt-80px">
    <div class="text-center">
      <div class="text-80px font-bold text-[var(--el-color-primary)]">403</div>
      <div class="text-14px text-[var(--el-color-info)]">{{ t('error.forbidden') }}</div>
      <div class="mt-20px">
        <ElButton type="primary" @click="backHome">{{ t('error.returnToHome') }}</ElButton>
      </div>
    </div>
  </div>
</template>

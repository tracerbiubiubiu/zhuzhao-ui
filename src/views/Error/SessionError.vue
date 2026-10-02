<script setup lang="ts">
  import { ElButton, ElResult } from 'element-plus'
  import { useRoute } from 'vue-router'
  import { isSafeRedirect } from '@/router/sessionError'

  /**
   * 会话加载瞬时失败页（§3.3：5xx/网络抖动/限流不清会话）
   * 守卫 catch transient 分支跳入（redirect 随 query 透传）；重试=整页重载重走守卫，
   * 会话（token）全程保留——后端恢复后即回到原目标页。
   */
  const route = useRoute()

  const retry = () => {
    // 复检 P3-5：拒协议相对 URL（//evil.com 形态的开放重定向面）——isSafeRedirect 统一实现
    const target = isSafeRedirect(route.query.redirect) ? route.query.redirect : '/'
    window.location.hash = `#${target}`
    window.location.reload()
  }
</script>

<template>
  <div class="flex h-screen items-center justify-center">
    <ElResult
      icon="warning"
      title="会话加载失败"
      sub-title="后端暂时不可用或网络抖动，会话已保留。请稍后重试。"
    >
      <template #extra>
        <ElButton type="primary" @click="retry">重试</ElButton>
      </template>
    </ElResult>
  </div>
</template>

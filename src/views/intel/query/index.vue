<script setup lang="ts">
/**
 * 情报查询页（S9 B9-1 菜单行落成页面——viewNames 守卫要求 visible 种子须有
 * 视图文件；B9-1 只交付了查询端点，页面=最小查询表单+结果 JSON 展示）。
 */
import { ref } from 'vue'
import { ElButton, ElCard, ElEmpty, ElInput, ElMessage, ElOption, ElSelect, ElTag } from 'element-plus'
import { queryIntelApi } from '@/api/intel'

// keep-alive 契约：name=动态路由名（菜单 code intel_query）
defineOptions({ name: 'intel_query_page' })

const intelType = ref('ip')
const value = ref('')
const loading = ref(false)
const result = ref<unknown>(null)
const stale = ref(false)
const fetchedAt = ref('')

async function query() {
  if (!value.value.trim()) {
    ElMessage.warning('请输入查询值')
    return
  }
  loading.value = true
  try {
    const data = await queryIntelApi(intelType.value, value.value.trim())
    const d = data as unknown as { result: unknown; stale: boolean; fetched_at: string }
    result.value = d.result
    stale.value = d.stale
    fetchedAt.value = d.fetched_at
  } catch {
    // 错误 toast 由拦截器统一处理
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never">
      <template #header><span class="font-semibold">威胁情报查询（缓存代理——先本地缓存后上游）</span></template>
      <div class="flex items-center gap-2 mb-3">
        <el-select v-model="intelType" class="!w-[120px]">
          <el-option label="IP" value="ip" />
          <el-option label="域名" value="domain" />
          <el-option label="Hash" value="hash" />
          <el-option label="URL" value="url" />
        </el-select>
        <el-input
          v-model="value" placeholder="查询值（IP/域名/hash/url）" class="!w-[320px]" maxlength="200"
          data-testid="intel-value" @keyup.enter="query"
        />
        <el-button type="primary" :loading="loading" data-testid="intel-query" @click="query">查询</el-button>
        <el-tag v-if="stale" type="warning" size="small">陈旧缓存（上游配额耗尽降级）</el-tag>
      </div>
      <pre v-if="result" class="text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded overflow-auto max-h-[480px]">{{ JSON.stringify(result, null, 2) }}</pre>
      <el-empty v-else description="输入查询值开始" />
      <div v-if="fetchedAt" class="text-xs text-gray-400 mt-2">数据时间：{{ fetchedAt }}</div>
    </el-card>
  </div>
</template>

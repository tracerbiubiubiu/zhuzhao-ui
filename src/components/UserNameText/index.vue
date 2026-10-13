<template>
  <span class="user-name-text">{{ display }}</span>
</template>

<script setup lang="ts">
/**
 * UserNameText 用户统一展示（2026-10-13 展示统一批，phase4/03 S9 契约增补）：
 * 「人名(工号)」三态降级——人名+工号 → 人名(工号)；仅其一 → 该值；全空 → fallback
 * （调用方传原始 ID）。消歧器 = 工号（全员必有/短/中性——域账号覆盖率与敏感性
 * 均劣，见 phase5 §6 与 dd §24）；数据源 = 后端结构化回填字段（*_name + *_no）。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name?: string | null
    no?: string | null
    fallback?: string | number | null
  }>(),
  { name: '', no: '', fallback: null }
)

const displayName = computed(() => (props.name ?? '').trim())
const displayNo = computed(() => (props.no ?? '').trim())

const display = computed(() => {
  if (displayName.value && displayNo.value) return `${displayName.value}(${displayNo.value})`
  if (displayName.value) return displayName.value
  if (displayNo.value) return displayNo.value
  return props.fallback !== null && props.fallback !== undefined && props.fallback !== ''
    ? String(props.fallback)
    : '—'
})
</script>

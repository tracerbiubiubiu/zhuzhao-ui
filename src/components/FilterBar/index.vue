<script setup lang="ts">
/**
 * 筛选栏折叠容器（2026-10-30 筛选栏展开/收起批）：
 * 宽度不够强行压一行不现实——默认只显示前 K 个控件（其余收起），
 * 「展开」切换全量；控件超阈值才出现切换按钮（≤K 个时无按钮零打扰）。
 * 配方衔接：仍是 flex-wrap 布局（筛选栏配方 #1），重置/动作按钮
 * 由调用方放槽尾照常 ml-auto 钉右；本组件只管折叠态与切换钮。
 * 阈值可按页覆盖（宽屏页可放宽）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElButton } from 'element-plus'

const props = withDefaults(defineProps<{ /** 收起态可见控件数 */ visible?: number }>(), { visible: 4 })

const expanded = ref(false)
const barRef = ref<HTMLElement>()

/** 控件总数（挂载后实测直接子元素——含 ml-auto 动作钮不计，用 data-ignore 标记） */
const itemCount = ref(0)

onMounted(() => {
  itemCount.value = Array.from(barRef.value?.children ?? []).filter(
    (el) => !(el as HTMLElement).dataset?.ignore && !(el as HTMLElement).classList?.contains('filter-collapse-toggle'),
  ).length
})

const collapsible = computed(() => itemCount.value > props.visible)
</script>

<template>
  <div
    ref="barRef"
    class="flex flex-wrap items-center gap-4 filter-bar"
  >
    <slot />
    <el-button
      v-if="collapsible"
      link type="primary" size="small" class="filter-collapse-toggle"
      :class="expanded ? '' : 'ml-auto'"
      @click="expanded = !expanded"
    >{{ expanded ? '收起' : '展开' }}</el-button>
  </div>
</template>


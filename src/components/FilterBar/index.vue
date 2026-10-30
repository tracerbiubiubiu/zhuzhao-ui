<script setup lang="ts">
/**
 * 筛选栏折叠容器（2026-10-30 筛选栏展开/收起批）：
 * 宽度不够强行压一行不现实——默认只显示前 K 个控件（其余收起），
 * 「展开」切换全量；控件超阈值才出现切换按钮（≤K 个时无按钮零打扰）。
 * 配方衔接：仍是 flex-wrap 布局（筛选栏配方 #1），动作按钮由调用方放槽尾
 * ml-auto 钉右（data-ignore 标记不折叠——收起态仍可见）。
 * 折叠经 JS 直控子元素 display + MutationObserver 重应用（槽内容异步重建
 * 会丢内联样式；nth-child+calc 非标准且 lightningcss 拒绝编译——build 实证）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton } from 'element-plus'

const props = withDefaults(defineProps<{ /** 收起态可见控件数 */ visible?: number }>(), { visible: 4 })

const expanded = ref(false)
const barRef = ref<HTMLElement>()

/** 受控控件（直接子元素，去 data-ignore 动作钮与本组件切换钮） */
function controlEls(): HTMLElement[] {
  return Array.from(barRef.value?.children ?? []).filter(
    (el) =>
      !(el as HTMLElement).dataset?.ignore &&
      !(el as HTMLElement).classList.contains('filter-collapse-toggle'),
  ) as HTMLElement[]
}

const itemCount = ref(0)

function applyCollapse() {
  controlEls().forEach((el, i) => {
    el.style.display = !expanded.value && i >= props.visible ? 'none' : ''
  })
}

function recount() {
  itemCount.value = controlEls().length
  applyCollapse()
}

let obs: MutationObserver | undefined

onMounted(async () => {
  await nextTick()
  recount()
  // ProTable 加载后重渲 search 槽会重挂子元素（内联 display 随之丢失）
  obs = new MutationObserver(() => recount())
  obs.observe(barRef.value!, { childList: true })
})

onBeforeUnmount(() => obs?.disconnect())

watch(expanded, applyCollapse)

const collapsible = computed(() => itemCount.value > props.visible)
</script>

<template>
  <div ref="barRef" class="flex flex-wrap items-center gap-4 filter-bar">
    <slot />
    <el-button
      v-if="collapsible"
      link type="primary" size="small" class="filter-collapse-toggle"
      :class="expanded ? '' : 'ml-auto'"
      @click="expanded = !expanded"
    >{{ expanded ? '收起' : '展开' }}</el-button>
  </div>
</template>

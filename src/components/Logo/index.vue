<script setup lang="ts">
  import { computed } from 'vue'
  import { useAppStore } from '@/store/modules/app'
  import { appConfig } from '@/config/app'

  const prefixCls = 'v-logo'

  const props = withDefaults(
    defineProps<{
      compact?: boolean
      /** 竖排形态（dual rail 专用）：图标上、系统名小字下——窄栏品牌两可见 */
      stack?: boolean
    }>(),
    {
      compact: false,
      stack: false
    }
  )

  const appStore = useAppStore()

  const title = appConfig.title

  const layout = computed(() => appStore.layout)

  const showTitle = computed(
    () =>
      props.stack ||
      (!props.compact && (layout.value === 'top' || layout.value === 'mixed' || !appStore.collapse))
  )
</script>

<template>
  <div>
    <router-link
      :class="[
        prefixCls,
        layout === 'top' || layout === 'mixed' ? `${prefixCls}--header` : '',
        props.stack ? `${prefixCls}--stack` : '',
        'flex !h-[var(--logo-height)] items-center cursor-pointer px-10px relative decoration-none overflow-hidden'
      ]"
      to="/"
    >
      <img src="@/assets/imgs/logo.png" class="w-38px h-38px flex-none" />
      <!-- 常驻+透明度过渡(不随 v-if 卸载):侧栏宽度动画期间文字淡入淡出,消除闪现 -->
      <div
        :class="[
          'ml-10px text-15px font-600 tracking-[-0.01em] whitespace-nowrap transition-opacity duration-200',
          props.stack ? '!ml-0 !mt-1px !text-10px max-w-full' : '',
          {
            'text-[var(--logo-title-text-color)]': layout === 'sidebar' || layout === 'dual',
            'text-[var(--top-header-text-color)]': layout === 'top' || layout === 'mixed',
            'opacity-0': !showTitle
          }
        ]"
      >
        {{ title }}
      </div>
    </router-link>
  </div>
</template>

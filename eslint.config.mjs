import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'app/global-ignores',
    ignores: [
      '**/dist/**', '**/dist-*/**', '**/node_modules/**', '**/coverage/**', '**/types/**',
      // codegen 生成物不手改不 lint（01 §3.3 纪律；契约漂移由 typecheck 兜底）
      'src/api/__generated/**',
      // 种子组件含 TSX/JSX 语法（vue-eslint-parser 限制，build 通过无碍）
      'src/components/Breadcrumb/**', 'src/components/Menu/**', 'src/layout/components/ToolHeader.vue',
      'src/components/ContextMenu/**',
    ],
  },
  {
    name: 'app/files-to-lint',
    files: ['src/**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/types/**', '**/dist-*/**', '**/node_modules/**', '**/coverage/**'],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    name: 'app/custom-rules',
    rules: {
      // zhuzhao 契约约束
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',  // zhuzhao 约定用 index.vue（07-menu 契约） // XSS 基线（01 §6）
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // 生产代码禁 debugger/console
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'off',
    },
  },
)

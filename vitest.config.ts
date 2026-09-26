import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * Vitest 配置（01 §7 单元测试门禁）
 *
 * 纯逻辑测试：environment='node'（composables / 动态路由解析 / tokenStorage / 单飞刷新），
 * 不引入 jsdom/@vue/test-utils。用最小 localStorage 垫片满足 tokenStorage（见 src/test/setup.ts）。
 * 别名与 vite.config.ts 对齐（@ 与 @vea/*）。
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /@\//, replacement: `${r('./src')}/` },
      { find: '@vea/styles', replacement: r('./src/common/styles/src/index.less') },
      { find: '@vea/components', replacement: r('./src/common/components/src') },
      { find: '@vea/hooks', replacement: r('./src/common/hooks/src') },
      { find: '@vea/request', replacement: r('./src/common/request/src') },
    ],
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})

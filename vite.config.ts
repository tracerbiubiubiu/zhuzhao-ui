import { resolve } from 'path'
import { loadEnv } from 'vite'
import type { UserConfig, ConfigEnv } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import UnoCSS from 'unocss/vite'
import ElementPlus from 'unplugin-element-plus/vite'

const root = process.cwd()

function pathResolve(dir: string) {
  return resolve(root, '.', dir)
}

export default ({ mode }: ConfigEnv): UserConfig => {
  const env = loadEnv(mode, root)
  return {
    base: env.VITE_BASE_PATH,
    plugins: [
      Vue(),
      VueJsx(),
      // {} 显式传参：unplugin 类型签名无零参重载（运行时等价）
      ElementPlus({}),
      VueI18nPlugin({
        runtimeOnly: true,
        compositionOnly: true,
        include: [resolve(import.meta.dirname, 'src/locales/**')]
      }),
      UnoCSS()
    ],

    resolve: {
      alias: [
        {
          find: /@\//,
          replacement: `${pathResolve('src')}/`
        },
        {
          find: '@vea/styles',
          replacement: pathResolve('src/common/styles/src/index.less')
        },
        {
          find: '@vea/components',
          replacement: pathResolve('src/common/components/src')
        },
        {
          find: '@vea/hooks',
          replacement: pathResolve('src/common/hooks/src')
        },
        {
          find: '@vea/request',
          replacement: pathResolve('src/common/request/src')
        }
      ]
    },
    build: {
      target: 'es2015',
      outDir: env.VITE_OUT_DIR || 'dist',
      sourcemap: env.VITE_SOURCEMAP === 'true',
      cssCodeSplit: !(env.VITE_USE_CSS_SPLIT === 'false'),
      cssTarget: ['chrome31'],
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'zrender',
                test: /node_modules[\\/]zrender[\\/]/
              }
            ]
          }
        }
      }
    },
    server: {
      // strictPort（2026-10-29 端口事故批）：被占时显式失败而非静默挪号——
      // auto-increment 漂移曾致浏览器/E2E baseURL 与实际端口错位四天未察觉
      // （4000 被 10/25 遗留 vite 占用，全部实例漂到 4001；QQ 又抢 4001 IPv4）。
      // 冲突时杀旧实例或 VITE_PORT 覆盖（端口表：docs/ops/port-allocation.md）。
      port: Number(process.env.VITE_PORT) || 4000,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:33333',
          changeOrigin: true
        },
        '/al': {
          target: 'http://127.0.0.1:33333',
          changeOrigin: true
        }
      },
      // 启动期预热全部源码：依赖优化器一次性完成 element-plus 按需样式发现——
      // 否则首访页面时逐轮「optimized deps changed. reloading」整页刷新，会打断
      // E2E 登录途中的在途请求（E2E 首跑假失败的根因）
      warmup: {
        clientFiles: ['./index.html', './src/**/*.{vue,ts}']
      },
      hmr: {
        overlay: false
      },
      host: '0.0.0.0'
    }
  }
}

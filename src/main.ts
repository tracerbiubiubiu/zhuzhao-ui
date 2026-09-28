import 'vue/jsx'

import 'virtual:uno.css'

// 初始化多语言
import { setupI18n } from '@/plugins/vueI18n'

// 引入状态管理
import { setupStore } from '@/store'

// 全局组件
import { setupGlobCom } from '@/components'

// 引入element-plus
import { setupElementPlus } from '@/plugins/elementPlus'

// 引入全局样式
import '@vea/styles'

// 路由
import { setupRouter } from './router'

import { createApp } from 'vue'

import App from './App.vue'

import { setupPermission } from './permission'
import { vPermission } from '@/common/auth'

// 创建实例
const setupAll = async () => {

  const app = createApp(App)
  app.directive('permission', vPermission)

  // §6 全局错误兜底：未捕获的渲染/生命周期错误统一上报 console
  // （Sentry 接入=触发驱动，届时替换上报端、此兜底保留）
  app.config.errorHandler = (err, _instance, info) => {
    console.error(`[errorHandler] ${info}:`, err)
  }

  setupStore(app)

  await setupPermission()

  setupI18n(app)

  setupGlobCom(app)

  setupElementPlus(app)

  setupRouter(app)

  app.mount('#app')
}

setupAll()

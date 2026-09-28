/**
 * Element Plus 按需样式深路径模块无类型定义（纯 css 副作用导入，运行时由 vite 处理）。
 * errorToast.ts 的 notifyError 动态引入 ElMessage 样式时使用（unplugin-element-plus
 * 只对静态 import 注入样式——动态整包导入须自带样式 chunk）。
 */
declare module 'element-plus/es/components/message/style/css'

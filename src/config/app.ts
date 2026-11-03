export const appConfig = {
  title: import.meta.env.VITE_APP_TITLE,
  ui: {
    breadcrumb: true,
    breadcrumbIcon: true,
    hamburger: true,
    theme: true,
    // 英文面未启用不露出切换器（i18n 口径 2026-10-02 拍板/AGENTS）——露出即承诺，
    // en 词包仅骨架（3.2KB 且页面文案硬编码中文）；触发器=英文用户出现，届时回 true 即恢复
    // ToolHeader 与 Login 双挂载点（2026-11-03 业界对齐批）
    locale: false,
    tagsViewIcon: true,
    footer: true,
    uniqueOpened: false
  }
} as const

<script setup lang="ts">
/**
 * 菜单管理（P4-W3——W1 菜单只读化后无写接口，纯只读树 + 角色分配入口）
 *
 * 树数据=GET /menus 管理面全量树（含按钮节点）；节点标注 menu_type（目录/页面/按钮）
 * 与 permission 字面值（B13 勾选树按 menus.permission 拼按钮码——展示供管理员对照）。
 */
import { ElButton, ElCard, ElTag, ElTree } from 'element-plus'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getMenuTreeApi } from '@/api/system/menu'

// keep-alive 契约：name=动态路由名（tagsView.cachedViews 存路由名，include 按组件名匹配）
defineOptions({ name: 'system_menu' })

const router = useRouter()
const treeQuery = useQuery({ queryKey: ['system', 'menus'], queryFn: getMenuTreeApi })

function toAssign() {
  // 分配入口=角色页（AssignMenus 勾选树 check-strictly）
  router.push('/system/role')
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">菜单词表（只读）</span>
          <el-button type="primary" link @click="toAssign">去角色页分配菜单 →</el-button>
        </div>
      </template>
      <el-tree
        v-loading="treeQuery.isLoading.value"
        :data="treeQuery.data.value ?? []"
        node-key="id"
        :props="{ label: 'name', children: 'children' }"
        default-expand-all
        :expand-on-click-node="false"
      >
        <template #default="{ data }">
          <span class="flex items-center gap-2 flex-1 min-w-0">
            <span>{{ data.name }}</span>
            <el-tag v-if="data.menu_type === 1" size="small" type="info">目录</el-tag>
            <el-tag v-else-if="data.menu_type === 2" size="small" type="success">页面</el-tag>
            <el-tag v-else size="small" type="warning">按钮</el-tag>
            <span v-if="data.permission" class="text-xs text-gray-400 truncate">{{ data.permission }}</span>
            <span class="text-xs text-gray-300 truncate ml-auto">{{ data.code }}</span>
          </span>
        </template>
      </el-tree>
    </el-card>
  </div>
</template>

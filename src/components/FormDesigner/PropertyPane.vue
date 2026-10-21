<template>
  <div class="fd-panel">
    <template v-if="field">
      <h4 class="fd-panel-title">{{ catalogOf(field.field_type).label }} · 属性</h4>

      <el-form label-position="top" size="small" @submit.prevent>
        <el-form-item label="字段标签（field_label）">
          <el-input v-model="field.field_label" maxlength="100" data-testid="fd-label" />
        </el-form-item>

        <el-form-item v-if="catalogOf(field.field_type).hasKey" label="字段键（field_key · 唯一 · ASCII）" :error="keyErr">
          <el-input v-model="field.field_key" maxlength="50" data-testid="fd-key" />
        </el-form-item>

        <el-form-item label="字段类型">
          <el-select v-model="field.field_type" data-testid="fd-type">
            <el-option v-for="c in FIELD_CATALOG" :key="c.type" :label="c.label" :value="c.type" />
          </el-select>
        </el-form-item>

        <el-form-item label="">
          <el-switch v-model="field.required" active-text="必填（required）" data-testid="fd-required" />
        </el-form-item>

        <template v-if="isOptionType(field.field_type)">
          <el-form-item label="选项来源">
            <el-radio-group v-model="optMode" size="small" data-testid="fd-opt-mode">
              <el-radio-button value="static">静态选项</el-radio-button>
              <el-radio-button value="dict">挂字典</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="optMode === 'dict'" label="字典类型（选项全系统联动——字典项变更即生效）">
            <el-select
              v-model="dictSel"
              filterable
              allow-create
              :loading="dictTypesLoading"
              placeholder="选择或输入字典 code"
              data-testid="fd-dict-ref"
            >
              <el-option v-for="d in dictTypes" :key="d.code" :label="`${d.name}（${d.code}）`" :value="d.code" />
            </el-select>
            <div v-if="dictPreview.length" class="fd-hint">
              预览：{{ dictPreview.map((i) => i.label).join(' / ') }}
            </div>
            <div v-else class="fd-hint">（字典无启用项或 code 手输——保存后守卫保引用）</div>
          </el-form-item>

          <el-form-item v-else label="选项（field_options）">
            <div class="fd-opts">
              <div v-for="(o, oi) in field.field_options" :key="oi" class="fd-opt-row">
                <el-input v-model="o.label" placeholder="标签（回显用）" />
                <el-input v-model="o.value" placeholder="值" />
                <el-button link type="danger" @click="emit('remove-option', selected, oi)">删</el-button>
              </div>
              <el-button size="small" @click="emit('add-option', selected)">+ 选项</el-button>
            </div>
          </el-form-item>
        </template>

        <el-form-item v-if="catalogOf(field.field_type).hasKey" label="校验正则（validate_regex）" :error="regexErr">
          <el-input v-model="field.validate_regex" placeholder="如 ^\d{1,3}$" data-testid="fd-regex" />
        </el-form-item>

        <el-form-item
          v-if="field.field_type === 'number' || field.field_type === 'input'"
          label="计算公式（field_meta.formula · 服务端求值 SSOT——提交时自动算入）"
        >
          <el-input v-model="field.formula" placeholder="如 price * qty（引用其他字段键）" data-testid="fd-formula" />
          <div class="fd-hint">公式字段提交时服务端重算覆盖手填值（前端预览值不可信）</div>
        </el-form-item>

        <div class="fd-hint">sort_order = {{ field.sort_order }}（画布拖拽调整顺序）</div>
      </el-form>
    </template>
    <div v-else class="fd-panel-empty">选中画布中的字段后编辑属性</div>
  </div>
</template>

<script setup lang="ts">
/**
 * PropertyPane 属性面板层（B1-1 三层分离之四）。
 *
 * 面板直接 v-model 设计器字段（响应式对象引用）——key/regex 即时校验文案由
 * useDesigner 的 keyError/regexError 提供（G2 同款预检，服务端为 SSOT）。
 * 字段类型可在面板内切换（选项面随类型重建——useDesigner.update）。
 */
import { computed, ref, watch } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSwitch } from 'element-plus'
import { listDictTypesApi, getDictItemsByCodeApi, type DictTypeRow, type DictItemRow } from '@/api/system/dict'
import { isOptionType } from './schemaAdapter'
import { FIELD_CATALOG, catalogOf, type DesignerField } from './types'

const props = defineProps<{
  field: DesignerField | null
  selected: number
  keyErr: string
  regexErr: string
}>()
const emit = defineEmits<{ (e: 'add-option', idx: number): void; (e: 'remove-option', idx: number, optIdx: number): void }>()

const field = computed(() => props.field)

// ── B1-2 挂字典：模式切换（静态/字典互斥——dictRef 即模式态） ──
const optMode = computed({
  get: () => (field.value?.dictRef ? 'dict' : 'static'),
  set: (m: 'static' | 'dict') => {
    if (!field.value) return
    if (m === 'dict' && !field.value.dictRef) {
      field.value.dictRef = dictTypes.value[0]?.code ?? ''
      field.value.field_options = field.value.field_options?.length ? field.value.field_options : [{ label: '选项一', value: 'opt1' }]
    } else if (m === 'static') {
      field.value.dictRef = undefined
    }
  },
})
const dictSel = computed({
  get: () => field.value?.dictRef ?? '',
  set: (code: string) => {
    if (field.value) field.value.dictRef = code
  },
})

// 字典类型清单（管理面 listTypes——无 dict:read 时降级手输 code）
const dictTypes = ref<DictTypeRow[]>([])
const dictTypesLoading = ref(false)
;(async () => {
  dictTypesLoading.value = true
  try {
    const r = await listDictTypesApi({ page: 1, page_size: 100 }).catch(() => null)
    dictTypes.value = r?.list ?? []
  } finally {
    dictTypesLoading.value = false
  }
})()

// 选中字典的启用项预览
const dictPreview = ref<DictItemRow[]>([])
watch(
  () => field.value?.dictRef,
  async (code) => {
    dictPreview.value = []
    if (!code) return
    dictPreview.value = (await getDictItemsByCodeApi(code).catch(() => [])) ?? []
  },
  { immediate: true },
)
</script>

<style scoped>
.fd-panel { height: 100%; overflow: auto; padding: 10px; }
.fd-panel-title { font-size: 13px; margin: 0 0 10px; color: var(--el-text-color-primary); }
.fd-panel-empty { color: var(--el-text-color-placeholder); font-size: 12px; padding: 24px 0; text-align: center; }
.fd-opts { width: 100%; display: flex; flex-direction: column; gap: 4px; }
.fd-opt-row { display: flex; gap: 4px; align-items: center; }
.fd-hint { color: var(--el-text-color-placeholder); font-size: 12px; margin-top: 4px; }
</style>

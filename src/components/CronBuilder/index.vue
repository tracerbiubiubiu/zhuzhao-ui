<template>
  <div class="cron-builder" data-testid="cron-builder">
    <el-radio-group v-model="mode" size="small">
      <el-radio-button value="preset">预设</el-radio-button>
      <el-radio-button value="expert">专家（表达式）</el-radio-button>
    </el-radio-group>

    <!-- 预设模式 -->
    <div v-if="mode === 'preset'" class="mt-2 flex flex-wrap items-center gap-2">
      <el-select v-model="cfg.kind" size="small" class="!w-[120px]" data-testid="cron-preset-kind" @change="emitSpec">
        <el-option label="每天" value="daily" />
        <el-option label="每周" value="weekly" />
        <el-option label="每隔 N 小时" value="hourly" />
        <el-option label="每月" value="monthly" />
      </el-select>

      <template v-if="cfg.kind === 'weekly'">
        <el-select v-model="cfg.day" size="small" class="!w-[90px]" @change="emitSpec">
          <el-option v-for="(w, i) in WEEKDAYS" :key="i" :label="w" :value="i" />
        </el-select>
      </template>
      <template v-if="cfg.kind === 'monthly'">
        <el-input-number v-model="cfg.day" size="small" :min="1" :max="31" controls-position="right" class="!w-[90px]" @change="emitSpec" />
        <span class="text-xs text-gray-400">号</span>
      </template>

      <template v-if="cfg.kind === 'hourly'">
        <span class="text-xs text-gray-400">间隔</span>
        <el-input-number v-model="cfg.hour" size="small" :min="1" :max="23" controls-position="right" class="!w-[90px]" @change="emitSpec" />
        <span class="text-xs text-gray-400">小时（整点起）</span>
      </template>

      <template v-else>
        <el-time-select
          v-model="timeHM"
          start="00:00" end="23:45" step="00:05"
          placeholder="选择时间" class="!w-[110px]" data-testid="cron-preset-time"
          @change="onTimeChange"
        />
      </template>
    </div>

    <!-- 专家模式 -->
    <div v-else class="mt-2">
      <el-input
        v-model="expertSpec" size="small" placeholder="分 时 日 月 周（五段，如 30 9 * * 1-5）"
        class="!w-[280px]" data-testid="cron-expert-input" @input="emitSpec"
      />
      <div class="text-xs text-gray-400 mt-1">五段：分 时 日 月 周（无秒字段）——保存后 next_run 回显即解析预览</div>
    </div>

    <div v-if="error" class="text-xs text-red-500 mt-1" data-testid="cron-error">{{ error }}</div>
    <div v-else class="text-xs text-gray-400 mt-1">
      产物：<code class="text-gray-600">{{ modelValue || '—' }}</code>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * CronBuilder cron 构造器（S4 B4-2——04 号附录 A.3）：预设四类 + 专家模式双 tab，
 * 产物 = cron_spec 五段字符串（taskrunner 解析零改动）。双向：初始值可反解析时
 * 回显预设，不可识别保持专家态。校验三道：preset 预检 / spec 五段粗检（六段
 * 带秒必拒——parser 无秒字段）/ taskrunner 保存 400 兜底。
 * 可点原型纪律（§3.1）合并入段走查——组件即原型，所有者走查时亲点定稿。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElInput, ElInputNumber, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTimeSelect } from 'element-plus'
import { presetToSpec, specToPreset, validatePreset, validateSpec, WEEKDAYS, type PresetConfig } from './presets'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

// 初始值反解析：可识别 → 预设态；否则专家态
const initial = specToPreset(props.modelValue)
const mode = ref<'preset' | 'expert'>(initial ? 'preset' : 'expert')
const cfg = reactive<PresetConfig>(initial ?? { kind: 'daily', hour: 9, minute: 0 })
const expertSpec = ref(initial ? '' : props.modelValue)
const error = ref('')

const timeHM = computed({
  get: () => `${String(cfg.hour ?? 0).padStart(2, '0')}:${String(cfg.minute ?? 0).padStart(2, '0')}`,
  set: (v: string) => {
    const [h, m] = (v ?? '9:00').split(':').map(Number)
    cfg.hour = h
    cfg.minute = m
    emitSpec()
  },
})

function onTimeChange(v: string | null) {
  if (v) timeHM.value = v
}

function emitSpec() {
  if (mode.value === 'preset') {
    const err = validatePreset(cfg)
    error.value = err
    if (!err) emit('update:modelValue', presetToSpec(cfg))
    return
  }
  const spec = expertSpec.value.trim()
  const err = validateSpec(spec)
  error.value = err
  if (!err) emit('update:modelValue', spec)
}

// 模式切换即按当前态产出（预设↔专家互切时表达式跟随）
watch(mode, () => {
  if (mode.value === 'expert' && !expertSpec.value) expertSpec.value = presetToSpec(cfg)
  emitSpec()
})
</script>

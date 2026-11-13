<template>
  <div class="condition-card">
    <div class="grid-2">
      <section>
        <h4 class="panel-title">阈值</h4>
        <ul class="rule-list">
          <li>
            <span>异常率阻断阈值</span>
            <span class="mono">≤ {{ (card.thresholds.abnormalRate * 100).toFixed(1) }}%</span>
          </li>
        </ul>
        <h4 class="panel-title" style="margin-top: 10px">口径</h4>
        <ul class="rule-list">
          <li>
            <span>空值填充值</span>
            <span class="mono">{{ card.caliber.nullFill }}</span>
          </li>
          <li>
            <span>视为空值</span>
            <span class="mono">{{ card.caliber.nullMarkers.join(' / ') }}</span>
          </li>
        </ul>
        <p class="hint" style="margin: 8px 0 0">{{ card.caliber.note }}</p>
      </section>
      <section>
        <h4 class="panel-title">判定规则</h4>
        <ul class="rule-list">
          <li v-for="rule in card.decisionRules" :key="rule.code">
            <span><span class="badge mute mono">{{ rule.code }}</span> {{ rule.label }}</span>
            <span class="hint">{{ rule.effect }}</span>
          </li>
        </ul>
      </section>
    </div>
    <h4 class="panel-title" style="margin-top: 10px">允许范围</h4>
    <div class="grid-2">
      <table class="data-table small-table">
        <thead><tr><th>字段</th><th>数值区间</th><th>允许取值</th></tr></thead>
        <tbody>
          <tr v-for="field in fields" :key="field">
            <td>{{ field }}</td>
            <td class="mono">
              <template v-if="card.allowedRanges.numeric[field]">
                [{{ card.allowedRanges.numeric[field].min ?? '-∞' }}, {{ card.allowedRanges.numeric[field].max ?? '+∞' }}]
              </template>
              <template v-else>—</template>
            </td>
            <td class="mono">{{ card.allowedRanges.enums[field]?.join(' / ') ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <table class="data-table small-table">
        <thead><tr><th>字段</th><th>格式规范</th><th>规范化</th></tr></thead>
        <tbody>
          <tr v-for="field in formatFields" :key="field">
            <td>{{ field }}</td>
            <td>{{ card.allowedRanges.formats[field].description }}</td>
            <td class="mono">{{ card.allowedRanges.formats[field].normalize }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { ConditionCard } from '@/data/cleanse-passport.types'
import { SAMPLE_FIELDS } from '@/data/cleanse-engine'

const props = defineProps<{ card: ConditionCard }>()

const fields = computed(() => [...SAMPLE_FIELDS])
const formatFields = computed(() => Object.keys(props.card.allowedRanges.formats))
</script>

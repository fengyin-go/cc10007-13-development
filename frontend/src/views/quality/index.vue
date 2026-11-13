<template>
  <section class="page" data-module="quality">
    <header class="page-head">
      <div>
        <h2>质量校验管理</h2>
        <p class="page-desc">
          质量校验按行护照计算阻断：完整性、版本一致性、原始值指纹、缺席理由与异常率阈值共同决定护照包能否流转。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新校验</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="hint" style="margin-bottom: 10px">
      清洗规则行仍在此登记校验口径；阻断结论以下方护照包的计算结果为准，规则状态不参与判定。
    </p>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': Number(row.id) === focusRuleId }" style="cursor: pointer" @click="focusRuleId = Number(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions" @click.stop>
              <button v-for="action in actions" :key="action" class="link" type="button" @click="runAction(action, row)">
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无质量校验数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条质量规则</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="panel" style="margin-top: 18px">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">护照包质量校验</h3>
          <p class="hint" style="margin: 4px 0 0">每一行的通过/阻断都能追溯到判定码与缺席理由。</p>
        </div>
        <div class="tag-row">
          <span class="badge mute">全部护照包 {{ summary.total }}</span>
          <span class="badge ok">通过 {{ summary.passed }}</span>
          <span class="badge bad">阻断 {{ summary.blocked }}</span>
          <span class="badge warn">未盖章 {{ summary.missingRows }} 行</span>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table small-table">
          <thead>
            <tr>
              <th>护照号</th><th>清洗规则</th><th>清洗版本</th><th>样本</th><th>异常率 / 阈值</th>
              <th>结论</th><th>阻断原因</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in qualityRows"
              :key="item.passport.passportNo"
              :class="{ 'row-selected': item.passport.passportNo === expandedNo }"
              style="cursor: pointer"
              @click="expandedNo = item.passport.passportNo"
            >
              <td class="mono">{{ item.passport.passportNo }}</td>
              <td>{{ item.passport.ruleCode }}</td>
              <td>{{ item.passport.ruleVersion }}</td>
              <td>{{ item.passport.totalRows }} 行</td>
              <td class="mono">
                {{ (item.verdict.anomalyRate * 100).toFixed(1) }}% /
                {{ (item.passport.conditionCard.thresholds.abnormalRate * 100).toFixed(1) }}%
              </td>
              <td>
                <span class="badge" :class="item.verdict.blocked ? 'bad' : 'ok'">{{ item.verdict.blocked ? '阻断' : '通过' }}</span>
              </td>
              <td>{{ item.verdict.reasons.join('；') || '—' }}</td>
              <td>
                <span v-if="item.accepted" class="badge ok">已接收</span>
                <span v-else class="badge mute">未接收</span>
              </td>
            </tr>
            <tr v-if="!qualityRows.length">
              <td colspan="8" class="empty-state">还没有护照包，先在清洗加工页处理样本</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="expanded">
        <div class="grid-2" style="margin-top: 12px">
          <section class="panel" style="margin: 0">
            <h4 class="panel-title">逐项校验</h4>
            <ul class="check-list">
              <li v-for="check in expanded.verdict.checks" :key="check.key">
                <span class="check-dot" :class="check.result === 'pass' ? 'ok' : check.result === 'warn' ? 'warn' : 'bad'"></span>
                <span>
                  <strong>{{ check.label }}</strong>：{{ check.detail }}
                  <span v-if="check.metric" class="hint">（{{ check.metric }} {{ check.value }}，要求 {{ check.bound }}）</span>
                </span>
              </li>
            </ul>
          </section>
          <section class="panel" style="margin: 0">
            <h4 class="panel-title">条件卡（随包固化）</h4>
            <ConditionCardView :card="expanded.passport.conditionCard" />
          </section>
        </div>
      </template>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ConditionCardView from '@/components/passport/ConditionCardView.vue'
import { ensureCleanseSeed } from '@/api/cleanse-service'
import { listQualityByPassports, qualitySummary } from '@/api/quality-service'
import { listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('quality')
const columns = ["规则编号", "校验表名", "目标字段", "校验表达式", "阈值下界", "阈值上界", "采样比例", "阻断级别"]
const actions = ["提交校验", "启用规则", "停用规则"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const focusRuleId = ref<number | null>(null)
const expandedNo = ref('')
const refreshTick = ref(0)

const summary = computed(() => {
  void refreshTick.value
  return qualitySummary()
})
const qualityRows = computed(() => {
  void refreshTick.value
  return listQualityByPassports()
})
const expanded = computed(() => {
  void refreshTick.value
  return qualityRows.value.find((item) => item.passport.passportNo === expandedNo.value) ?? null
})
const stats = computed(() => [
  { label: '护照包总数', value: summary.value.total },
  { label: '通过护照包', value: summary.value.passed },
  { label: '阻断护照包', value: summary.value.blocked },
])

function refresh() {
  refreshTick.value += 1
  errorMessage.value = ''
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  refresh()
}

function reload() {
  try {
    const payload = listEntries(meta.key)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '质量校验列表读取失败'
  }
}

onMounted(() => {
  ensureCleanseSeed()
  reload()
  refresh()
})
</script>

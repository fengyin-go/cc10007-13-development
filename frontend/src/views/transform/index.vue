<template>
  <section class="page" data-module="transform">
    <header class="page-head">
      <div>
        <h2>转换编排管理</h2>
        <p class="page-desc">
          转换编排只接受同一清洗版本的完整护照包：包护照完整、质量未阻断并已接收，节点才能启用；
          同一个包重复接收返回原护照号。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记转换节点</button>
        <button class="btn" type="button" @click="exportRows">导出转换编排清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>护照准入</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td>
              <span class="badge" :class="gateOf(row).tone">{{ gateOf(row).label }}</span>
            </td>
            <td class="row-actions">
              <button v-for="action in actions" :key="action" class="link" type="button" @click="runAction(action, row)">
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无转换编排数据，可先登记转换节点</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条转换编排记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div class="grid-2" style="margin-top: 18px">
      <section class="panel" style="margin: 0">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">可接收的护照包</h3>
            <p class="hint" style="margin: 4px 0 0">准入按护照计算：同版本、完整、质量不阻断。</p>
          </div>
          <button class="btn" type="button" @click="refresh">刷新</button>
        </div>
        <table class="data-table small-table">
          <thead><tr><th>护照号</th><th>输出表</th><th>版本</th><th>完整</th><th>质量</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in advisory" :key="item.passport.passportNo">
              <td class="mono">{{ item.passport.passportNo }}</td>
              <td>{{ item.passport.outputTable }}</td>
              <td>{{ item.passport.ruleVersion }}</td>
              <td><span class="badge" :class="item.passport.complete ? 'ok' : 'warn'">{{ item.passport.complete ? '完整' : '待补齐' }}</span></td>
              <td><span class="badge" :class="item.verdict.blocked ? 'bad' : 'ok'">{{ item.verdict.blocked ? '阻断' : '通过' }}</span></td>
              <td>
                <span v-if="item.accepted" class="badge ok">已接收</span>
                <button v-else class="link" type="button" @click="admit(item.passport.passportNo)">接收</button>
              </td>
            </tr>
            <tr v-if="!advisory.length">
              <td colspan="6" class="empty-state">清洗加工还没有产出护照包</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel" style="margin: 0">
        <div class="panel-head">
          <h3 class="panel-title">已接收护照包</h3>
          <span class="hint">节点启用只认这里的包护照号</span>
        </div>
        <ul class="rule-list">
          <li v-for="item in acceptedPassports" :key="item.passport.passportNo">
            <span>
              <span class="mono">{{ item.passport.passportNo }}</span>
              · {{ item.passport.outputTable }} · {{ item.passport.ruleVersion }}
            </span>
            <span class="hint">{{ acceptedIndex[item.passport.passportNo]?.at }} {{ acceptedIndex[item.passport.passportNo]?.actor }}</span>
          </li>
          <li v-if="!acceptedPassports.length">
            <span class="empty-hint">还没有接收任何护照包</span>
          </li>
        </ul>
        <p class="hint" style="margin-bottom: 0">
          重复接收同一包返回原护照号，不会为已接收的包重新盖章。
        </p>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { acceptedMap, admitPassport, ensureCleanseSeed } from '@/api/cleanse-service'
import { listQualityByPassports } from '@/api/quality-service'
import { transformGate } from '@/data/transform-gate'
import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('transform')
const columns = ["节点编号", "输入表名", "输出表名", "转换表达式", "执行顺序", "依赖节点", "失败策略", "调度周期"]
const actions = ["提交校验", "启用节点", "停用节点"]
const statuses = ["草稿", "待校验", "已启用", "已停用"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const tick = ref(0)

const advisory = computed(() => {
  void tick.value
  return listQualityByPassports()
})
const acceptedIndex = computed(() => {
  void tick.value
  return acceptedMap()
})
const acceptedPassports = computed(() =>
  advisory.value.filter((item) => Boolean(acceptedMap()[item.passport.passportNo])),
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '转换节点总数', value: total.value },
  { label: '已启用节点', value: rows.value.filter((row) => row.status === '已启用').length },
  { label: '已接收护照包', value: acceptedPassports.value.length },
])

function gateOf(row: EntryRow) {
  const inputTable = String(row['输入表名'] ?? '')
  const gate = transformGate(inputTable)
  if (gate.ok) {
    return { label: gate.message ? '护照已接收' : '无护照依赖', tone: gate.message ? 'ok' : 'mute' }
  }
  return { label: '缺护照包', tone: 'bad' }
}

function refresh() {
  tick.value += 1
}

function admit(passportNo: string) {
  const result = admitPassport(passportNo)
  errorMessage.value = result.message
  refresh()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '转换节点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '启用节点') {
    const gate = transformGate(String(row['输入表名'] ?? ''))
    if (!gate.ok) {
      errorMessage.value = gate.message
      return
    }
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  refresh()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '转换编排列表读取失败'
  }
}

onMounted(() => {
  ensureCleanseSeed()
  reload()
  refresh()
})
</script>

<template>
  <section class="page" data-module="cleanse">
    <header class="page-head">
      <div>
        <h2>清洗加工管理</h2>
        <p class="page-desc">
          清洗加工是主对象：样本经空值替换、格式规范化与异常阈值处理后，每个输出行签发一张行护照，
          携带原始值指纹、清洗版本与判定码；质量校验按护照计算阻断，转换编排只接收同一版本的完整护照包。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清洗规则</button>
        <button class="btn" type="button" @click="exportRows">导出清洗加工清单</button>
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
            <th>护照包</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="String(row.id)"
            :class="{ 'row-selected': Number(row.id) === selectedRuleId }"
            style="cursor: pointer"
            @click="selectRule(Number(row.id))"
          >
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td>
              <span class="badge" :class="passportCount(Number(row.id)) ? 'ok' : 'mute'">
                {{ passportCount(Number(row.id)) }} 个护照包
              </span>
            </td>
            <td class="row-actions" @click.stop>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无清洗加工数据，可先登记清洗规则</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条清洗加工记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
    <p v-if="notice" class="notice-text">{{ notice }}</p>

    <template v-if="selectedRule">
      <section class="panel" style="margin-top: 18px">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">行护照工作台 · {{ selectedRule['规则编号'] }}</h3>
            <p class="hint" style="margin: 4px 0 0">
              输入表 {{ selectedRule['输入表名'] }} → 目标表 {{ selectedRule['目标表名'] }}；
              条件卡随清洗版本固化，旧包始终按各自版本还原。
            </p>
          </div>
          <div class="tag-row">
            <span class="badge mute">当前清洗版本 {{ activeVersionLabel }}</span>
            <span class="badge" :class="selectedRule.status === '已启用' ? 'ok' : 'warn'">{{
              selectedRule.status
            }}</span>
          </div>
        </div>

        <div class="grid-2">
          <section>
            <div class="panel-head">
              <h4 class="panel-title">样本包</h4>
              <span class="hint">同一包重复处理返回原护照号</span>
            </div>
            <div class="inline-form" style="margin-bottom: 8px">
              <label>
                批次类型
                <select v-model="newBatchKind">
                  <option value="clean">全部合规</option>
                  <option value="light">少量异常</option>
                  <option value="mixed">高异常</option>
                </select>
              </label>
              <label>
                模拟中断行
                <input v-model="interruptRowsText" placeholder="如 2,5，留空表示不中断" />
              </label>
              <button class="btn" type="button" @click="createInput">登记样本包</button>
            </div>
            <div class="table-wrap">
              <table class="data-table small-table">
                <thead><tr><th>包编号</th><th>样本</th><th>登记时间</th><th>护照</th><th>处理</th></tr></thead>
                <tbody>
                  <tr v-for="input in inputs" :key="input.id">
                    <td class="mono">{{ input.packageKey }}</td>
                    <td>{{ input.samples.length }} 行</td>
                    <td>{{ input.submittedAt }}</td>
                    <td>
                      <span class="badge" :class="inputPassport(input) ? (inputPassport(input)!.complete ? 'ok' : 'warn') : 'mute'">
                        {{ inputPassport(input)?.passportNo ?? '未处理' }}
                      </span>
                    </td>
                    <td>
                      <button class="link" type="button" @click="process(input)">
                        {{ inputPassport(input) ? '重复处理' : '处理并盖章' }}
                      </button>
                      <button
                        v-if="canResign(input)"
                        class="link"
                        type="button"
                        @click="resign(input)"
                      >
                        按 {{ activeVersionLabel }} 重签
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!inputs.length">
                    <td colspan="5" class="empty-state">该规则还没有样本包</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div class="panel-head">
              <h4 class="panel-title">清洗版本</h4>
              <span class="hint">候选版本只生成新护照，不改写旧包</span>
            </div>
            <div class="inline-form" style="margin-bottom: 8px">
              <label>
                候选阈值
                <input v-model="candidateThreshold" placeholder="如 30%" />
              </label>
              <label>
                空值填充
                <input v-model="candidateNullFill" placeholder="如 空值填充:UNKNOWN" />
              </label>
              <button class="btn" type="button" @click="createCandidate">生成候选版本</button>
            </div>
            <ul class="rule-list">
              <li v-for="version in versions" :key="version.version">
                <span>
                  <span class="badge" :class="version.active ? 'ok' : 'mute'">{{ version.version }}</span>
                  {{ version.active ? '当前版本' : '只读' }} · 阈值 {{ (version.conditionCard.thresholds.abnormalRate * 100).toFixed(1) }}% ·
                  填充 {{ version.conditionCard.caliber.nullFill }}
                </span>
                <span class="hint">{{ version.createdAt }}</span>
              </li>
            </ul>
            <p class="hint" style="margin-bottom: 0">旧包仍可按各自快照还原原始输入与处理轨迹。</p>
          </section>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h4 class="panel-title">护照包</h4>
          <div class="tag-row">
            <button class="btn" type="button" :disabled="!selectedPassport" @click="repairSelected">补齐未盖章样本</button>
            <button class="btn primary" type="button" :disabled="!selectedPassport" @click="admitSelected">接收进转换编排</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table small-table">
            <thead>
              <tr>
                <th>护照号</th><th>包编号</th><th>清洗版本</th><th>盖章 / 隔离 / 未盖章</th>
                <th>质量</th><th>完整</th><th>接收</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="passport in passports"
                :key="passport.passportNo"
                :class="{ 'row-selected': passport.passportNo === selectedPassportNo }"
                style="cursor: pointer"
                @click="selectedPassportNo = passport.passportNo"
              >
                <td class="mono">{{ passport.passportNo }}</td>
                <td class="mono">{{ passport.packageKey }}</td>
                <td>{{ passport.ruleVersion }}</td>
                <td>{{ passport.stampedRows }} / {{ passport.quarantinedRows }} / {{ passport.missingRows }}</td>
                <td>
                  <span class="badge" :class="qualityOf(passport).blocked ? 'bad' : 'ok'">
                    {{ qualityOf(passport).blocked ? '阻断' : '通过' }}
                  </span>
                </td>
                <td>
                  <span class="badge" :class="passport.complete ? 'ok' : 'warn'">{{ passport.complete ? '完整' : '待补齐' }}</span>
                </td>
                <td>
                  <span class="badge" :class="isAccepted(passport) ? 'ok' : 'mute'">{{ isAccepted(passport) ? '已接收' : '未接收' }}</span>
                </td>
                <td class="row-actions" @click.stop>
                  <button v-if="passport.missingRows" class="link" type="button" @click="repair(passport)">补齐</button>
                  <button class="link" type="button" @click="admit(passport)">接收</button>
                </td>
              </tr>
              <tr v-if="!passports.length">
                <td colspan="8" class="empty-state">该规则还没有护照包</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <PassportDetail
        v-if="selectedPassport"
        :passport="selectedPassport"
        :quality="qualityOf(selectedPassport)"
        :admission="admissionOf(selectedPassport)"
        :accepted="isAccepted(selectedPassport)"
        :review="review"
        :restored="restoredText"
        @review="reviewPassport"
        @restore="restorePassport"
        @reprocess="reprocess"
      />
      <p v-else class="empty-hint">选择一条护照包查看行护照、质量校验与准入结论。</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  CLEANSE_ACTOR,
  acceptedMap,
  admitPassport,
  createCandidateVersion,
  createSampleInput,
  ensureCleanseSeed,
  getPassport,
  listInputs,
  listPassports,
  listVersions,
  passportAdmission,
  passportQuality,
  processInput,
  repairPackage,
  reprocessPassport,
  restorePassport as restorePassportData,
  reviewPassportVersion,
  activeVersion,
} from '@/api/cleanse-service'
import PassportDetail from '@/components/passport/PassportDetail.vue'
import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type {
  AdmissionVerdict,
  CleanseInput,
  PackagePassport,
  QualityVerdict,
  VersionReview,
} from '@/data/cleanse-passport.types'
import { stableStringify } from '@/utils/passport'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cleanse')
const columns = ["规则编号", "输入表名", "目标表名", "空值处理", "格式校验", "异常阈值", "规则版本", "生效日期"]
const actions = ["提交校验", "启用规则", "停用规则"]
const statuses = ["草稿", "待校验", "已启用", "已停用"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const selectedRuleId = ref<number | null>(null)
const selectedPassportNo = ref<string>('')
const newBatchKind = ref<'clean' | 'light' | 'mixed'>('clean')
const interruptRowsText = ref('')
const candidateThreshold = ref('')
const candidateNullFill = ref('')
const review = ref<VersionReview | null>(null)
const restoredText = ref('')
const tick = ref(0)
const notice = ref('')

const selectedRule = computed(() => rows.value.find((row) => Number(row.id) === selectedRuleId.value) ?? null)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '清洗规则总数', value: total.value },
  { label: '已启用规则', value: rows.value.filter((row) => row.status === '已启用').length },
  { label: '护照包总数', value: passports.value.length },
])
const inputs = computed(() => {
  void tick.value
  return selectedRuleId.value === null ? [] : listInputs(selectedRuleId.value)
})
const versions = computed(() => {
  void tick.value
  return selectedRuleId.value === null ? [] : listVersions(selectedRuleId.value)
})
const activeVersionLabel = computed(() => {
  void tick.value
  const version = selectedRuleId.value === null ? null : activeVersion(selectedRuleId.value)
  return version?.version ?? '未登记'
})
const passports = computed(() => {
  void tick.value
  return selectedRuleId.value === null ? [] : listPassports(selectedRuleId.value)
})
const selectedPassport = computed(() => {
  void tick.value
  if (!selectedPassportNo.value) {
    return null
  }
  return getPassport(selectedPassportNo.value)
})

function passportCount(ruleId: number): number {
  return listPassports(ruleId).length
}

function inputPassport(input: CleanseInput): PackagePassport | null {
  return (
    passports.value.find(
      (passport) => passport.inputId === input.id || passport.packageKey === input.packageKey,
    ) ?? null
  )
}

function qualityOf(passport: PackagePassport): QualityVerdict {
  return passportQuality(passport.passportNo) ?? { blocked: true, reasons: ['护照丢失'], checks: [], anomalyRate: 0, passRate: 0 }
}

function admissionOf(passport: PackagePassport): AdmissionVerdict {
  return (
    passportAdmission(passport.passportNo) ?? {
      accepted: false,
      reasons: ['护照丢失'],
      checks: [],
    }
  )
}

function isAccepted(passport: PackagePassport): boolean {
  void tick.value
  return Boolean(acceptedMap()[passport.passportNo])
}

function bump() {
  tick.value += 1
}

function selectRule(ruleId: number) {
  selectedRuleId.value = ruleId
  selectedPassportNo.value = passports.value[0]?.passportNo ?? ''
  review.value = null
  restoredText.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  setResult(false, '清洗规则登记入口尚未接入审批流；可先在下方工作台登记样本包并生成护照')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function parseInterrupts(text: string): number[] {
  return text
    .split(/[,，\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function createInput() {
  if (!selectedRuleId.value) return
  const result = createSampleInput(selectedRuleId.value, newBatchKind.value, {
    interruptRows: parseInterrupts(interruptRowsText.value),
  })
  setResult(result.ok, result.message)
  bump()
  reloadWorkbench()
}

function canResign(input: CleanseInput): boolean {
  const passport = inputPassport(input)
  return Boolean(passport) && passport!.ruleVersion !== activeVersionLabel.value
}

function resign(input: CleanseInput) {
  const version = activeVersionLabel.value
  const result = processInput(input.id, version)
  setResult(result.ok, result.message)
  if (result.passport) {
    selectedPassportNo.value = result.passport.passportNo
  }
  bump()
  reloadWorkbench()
}

function process(input: CleanseInput) {
  const result = processInput(input.id)
  setResult(result.ok, result.message)
  if (result.passport) {
    selectedPassportNo.value = result.passport.passportNo
  }
  bump()
  reloadWorkbench()
}

function createCandidate() {
  if (!selectedRuleId.value) return
  const result = createCandidateVersion(selectedRuleId.value, {
    abnormalThreshold: candidateThreshold.value.trim() || undefined,
    nullFill: candidateNullFill.value.trim() || undefined,
  })
  setResult(result.ok, result.message)
  candidateThreshold.value = ''
  candidateNullFill.value = ''
  bump()
  reload()
}

function repair(passport: PackagePassport) {
  const result = repairPackage(passport.passportNo)
  setResult(result.ok, result.message)
  bump()
  reloadWorkbench()
}

function repairSelected() {
  if (selectedPassport.value) {
    repair(selectedPassport.value)
  }
}

function admit(passport: PackagePassport) {
  const result = admitPassport(passport.passportNo)
  setResult(result.ok, result.message)
  bump()
  reloadWorkbench()
}

function admitSelected() {
  if (selectedPassport.value) {
    admit(selectedPassport.value)
  }
}

function reprocess(passportNo: string) {
  const result = reprocessPassport(passportNo)
  setResult(result.ok, result.message)
  bump()
  reloadWorkbench()
}

function reviewPassport(passportNo: string) {
  review.value = reviewPassportVersion(passportNo)
  restoredText.value = ''
}

function restorePassport(passportNo: string) {
  const restored = restorePassportData(passportNo)
  restoredText.value = restored ? stableStringify(restored) : '未找到可还原的原始输入'
  review.value = reviewPassportVersion(passportNo)
}

function setResult(ok: boolean, message: string) {
  if (ok) {
    errorMessage.value = ''
    notice.value = message
  } else {
    notice.value = ''
    errorMessage.value = message
  }
}

function reloadWorkbench() {
  const list = listPassports(selectedRuleId.value ?? undefined)
  if (!selectedPassportNo.value || !list.some((item) => item.passportNo === selectedPassportNo.value)) {
    selectedPassportNo.value = list[0]?.passportNo ?? ''
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (selectedRuleId.value === null || !payload.items.some((row) => Number(row.id) === selectedRuleId.value)) {
      selectedRuleId.value = payload.items.length ? Number(payload.items[0].id) : null
      selectedPassportNo.value = passports.value[0]?.passportNo ?? ''
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清洗加工列表读取失败'
  }
}

onMounted(() => {
  reload()
  ensureCleanseSeed()
  bump()
  reloadWorkbench()
  if (!selectedPassportNo.value) {
    selectedPassportNo.value = passports.value[0]?.passportNo ?? ''
  }
})
</script>

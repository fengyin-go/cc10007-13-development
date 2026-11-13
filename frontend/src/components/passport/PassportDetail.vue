<template>
  <div class="passport-detail">
    <div class="tag-row" style="margin-bottom: 10px">
      <span class="mono">{{ passport.passportNo }}</span>
      <span class="badge mute">包 {{ passport.packageKey }}</span>
      <span class="badge mute">清洗版本 {{ passport.ruleVersion }}</span>
      <span class="badge" :class="passport.blocked ? 'bad' : 'ok'">
        {{ passport.blocked ? '质量阻断' : '质量通过' }}
      </span>
      <span class="badge" :class="passport.complete ? 'ok' : 'warn'">
        {{ passport.complete ? '护照完整' : `未盖章 ${passport.missingRows}` }}
      </span>
      <span v-if="accepted" class="badge ok">已接收进转换编排</span>
    </div>

    <div class="stat-row" style="margin-bottom: 12px">
      <article class="stat-card"><span class="stat-label">样本总数</span><strong class="stat-value">{{ passport.totalRows }}</strong></article>
      <article class="stat-card"><span class="stat-label">已盖章</span><strong class="stat-value">{{ passport.stampedRows }}</strong></article>
      <article class="stat-card"><span class="stat-label">隔离留存</span><strong class="stat-value">{{ passport.quarantinedRows }}</strong></article>
      <article class="stat-card"><span class="stat-label">未盖章</span><strong class="stat-value">{{ passport.missingRows }}</strong></article>
      <article class="stat-card"><span class="stat-label">异常率</span><strong class="stat-value">{{ ((1 - quality.passRate) * 100).toFixed(1) }}%</strong></article>
    </div>

    <div class="grid-2">
      <section class="panel" style="margin: 0">
        <div class="panel-head">
          <h4 class="panel-title">质量校验（按护照计算）</h4>
          <span class="badge" :class="quality.blocked ? 'bad' : 'ok'">{{ quality.blocked ? '阻断' : '放行' }}</span>
        </div>
        <ul class="check-list">
          <li v-for="check in quality.checks" :key="check.key">
            <span class="check-dot" :class="check.result === 'pass' ? 'ok' : check.result === 'warn' ? 'warn' : 'bad'"></span>
            <span><strong>{{ check.label }}</strong>：{{ check.detail }}</span>
          </li>
        </ul>
      </section>
      <section class="panel" style="margin: 0">
        <div class="panel-head">
          <h4 class="panel-title">转换编排准入</h4>
          <span class="badge" :class="admission.accepted ? 'ok' : 'bad'">{{ admission.accepted ? '可接收' : '不可接收' }}</span>
        </div>
        <ul class="check-list">
          <li v-for="check in admission.checks" :key="check.label">
            <span class="check-dot" :class="check.ok ? 'ok' : 'bad'"></span>
            <span><strong>{{ check.label }}</strong>：{{ check.detail }}</span>
          </li>
        </ul>
      </section>
    </div>

    <section class="panel" style="margin: 12px 0 0">
      <div class="panel-head">
        <h4 class="panel-title">行护照</h4>
        <span class="hint">隔离样本保留原始值并写明缺席理由；未盖章行只等补齐，不重制已通过行。</span>
      </div>
      <div class="table-wrap">
        <table class="data-table small-table">
          <thead>
            <tr>
              <th>#</th>
              <th>行护照号</th>
              <th>原始值指纹</th>
              <th>判定码</th>
              <th>状态</th>
              <th>缺席理由 / 判定说明</th>
              <th>输出（金额 / 状态）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in passport.rows" :key="row.rowNo">
              <td>{{ row.rowNo }}</td>
              <td class="mono">{{ row.passportNo || '—（未盖章）' }}</td>
              <td class="mono">{{ row.sourceFingerprint }}</td>
              <td><span class="badge" :class="codeClass(row.decisionCode)">{{ row.decisionCode }}</span></td>
              <td>
                <span class="badge" :class="row.status === 'stamped' ? 'ok' : row.status === 'quarantined' ? 'warn' : 'bad'">
                  {{ statusLabel(row.status) }}
                </span>
              </td>
              <td>
                <template v-if="row.status === 'quarantined' || row.status === 'missing'">
                  <span class="badge bad" style="margin-right: 4px">缺席理由</span>{{ row.absentReason || '—' }}
                </template>
                <template v-else>{{ row.decision }}</template>
              </td>
              <td class="mono">{{ row.output['金额'] ?? '—' }} / {{ row.output['状态'] ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="grid-2" style="margin-top: 12px">
      <section class="panel" style="margin: 0">
        <div class="panel-head">
          <h4 class="panel-title">本包固化的条件卡（{{ passport.ruleVersion }}）</h4>
          <span class="hint">后续改规则只生成新护照，本卡不随新版本变化</span>
        </div>
        <ConditionCardView :card="passport.conditionCard" />
      </section>
      <section class="panel" style="margin: 0">
        <div class="panel-head">
          <h4 class="panel-title">回看与还原</h4>
          <div class="tag-row">
            <button class="btn" type="button" @click="$emit('review', passport.passportNo)">核对清洗版本</button>
            <button class="btn" type="button" @click="$emit('restore', passport.passportNo)">还原原始输入</button>
            <button class="btn" type="button" @click="$emit('reprocess', passport.passportNo)">重复处理</button>
          </div>
        </div>
        <p class="hint" style="margin-top: 0">
          内容哈希 <span class="mono">{{ passport.contentDigest }}</span> · 首次签发 {{ passport.firstCreatedAt }} · 最近刷新 {{ passport.createdAt }}
        </p>
        <ul class="trace-list">
          <li v-for="(item, index) in passport.trace" :key="index">
            <strong>{{ item.action }}</strong> · {{ item.at }} · {{ item.actor }} — {{ item.detail }}
          </li>
        </ul>
        <template v-if="review">
          <p style="margin: 10px 0 0; font-size: 13px">
            <span class="badge" :class="review.match ? 'ok' : 'warn'">{{ review.match ? '版本一致' : '版本已更新' }}</span>
            {{ review.note }}
          </p>
        </template>
        <pre v-if="restored" class="pre-box" style="margin-top: 10px">{{ restored }}</pre>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import ConditionCardView from './ConditionCardView.vue'
import type { AdmissionVerdict, PackagePassport, QualityVerdict } from '@/data/cleanse-passport.types'

defineProps<{
  passport: PackagePassport
  quality: QualityVerdict
  admission: AdmissionVerdict
  accepted: boolean
  review: { match: boolean; note: string } | null
  restored: string
}>()

defineEmits<{
  (event: 'review', passportNo: string): void
  (event: 'restore', passportNo: string): void
  (event: 'reprocess', passportNo: string): void
}>()

function codeClass(code: string): string {
  if (code === 'PASS') return 'ok'
  if (code === 'FILL' || code === 'FMT') return 'mute'
  return 'bad'
}

function statusLabel(status: string): string {
  if (status === 'stamped') return '已盖章'
  if (status === 'quarantined') return '隔离留存'
  return '未盖章'
}
</script>

import type {
  AdmissionVerdict,
  CleanseInput,
  CleanseSample,
  ConditionCard,
  PackagePassport,
  QualityCheck,
  QualityVerdict,
  RowPassport,
  RuleVersionSnapshot,
  VersionReview,
} from '@/data/cleanse-passport.types'
import type { EntryRow } from '@/data/types'
import { digestOf, fingerprintOf, passportNo, stableStringify } from '@/utils/passport'

/** 样本包字段：清洗只针对这些列做替换、规范化与阈值判定。 */
export const SAMPLE_FIELDS = ['客户编号', '手机号', '邮箱', '金额', '状态', '地区'] as const

export const DECISION_RULES: ConditionCard['decisionRules'] = [
  { code: 'PASS', label: '通过', effect: '原值进入输出流' },
  { code: 'FILL', label: '空值替换', effect: '按口径写入填充值后进入输出流' },
  { code: 'FMT', label: '格式规范化', effect: '规范化后进入输出流' },
  { code: 'RANGE', label: '越界', effect: '隔离留存，不进入输出流' },
  { code: 'ENUM', label: '枚举外', effect: '隔离留存，不进入输出流' },
  { code: 'FORMAT', label: '格式不合规', effect: '隔离留存，不进入输出流' },
  { code: 'UNSTAMPED', label: '未盖章', effect: '不进入输出流，补齐时再盖章' },
]

const DEFAULT_NULL_MARKERS = ['', 'NULL', 'null', 'N/A', 'NA', '-', '—']

/**
 * 从规则字段中解析异常阈值，支持 0.25 / 25% / 25 三种写法。
 * 字段不是明确的数值口径（例如仍是示例占位文案）时回落到默认 25%。
 */
export function parseThreshold(text: string): number {
  const source = String(text ?? '').trim()
  const percent = source.match(/^(\d+(?:\.\d+)?)\s*%$/)
  if (percent) {
    return clampRate(Number(percent[1]) / 100)
  }
  const numeric = source.match(/^(\d+(?:\.\d+)?)$/)
  if (numeric) {
    const value = Number(numeric[1])
    return clampRate(value > 1 ? value / 100 : value)
  }
  return 0.25
}

function clampRate(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 从「空值处理」字段解析填充值，格式为「空值填充:UNKNOWN」，缺省用 UNKNOWN。 */
export function parseNullFill(text: string): string {
  const source = String(text ?? '').trim()
  const matched = source.match(/(?:填充|替换|fill)\s*[:：=]\s*([^\s，,；;]+)/i)
  if (matched) {
    return matched[1]
  }
  if (!source || /样例|示例|默认/.test(source)) {
    return 'UNKNOWN'
  }
  return 'UNKNOWN'
}

/**
 * 条件卡：阈值、口径、判定规则与允许范围共用一张卡。
 * 规则字段只影响口径与阈值；允许范围由清洗标准统一给出，避免每次手填不一致。
 */
export function buildConditionCard(rule: EntryRow): ConditionCard {
  return {
    thresholds: {
      abnormalRate: parseThreshold(String(rule['异常阈值'] ?? '')),
    },
    caliber: {
      nullFill: parseNullFill(String(rule['空值处理'] ?? '')),
      nullMarkers: [...DEFAULT_NULL_MARKERS],
      note: `输入表 ${rule['输入表名'] ?? '—'} → 目标表 ${rule['目标表名'] ?? '—'}；规范：${String(
        rule['格式校验'] ?? '空值替换、去空白、手机号取数字、邮箱小写',
      )}`,
    },
    decisionRules: DECISION_RULES,
    allowedRanges: {
      numeric: {
        金额: { min: 0, max: 100000 },
      },
      enums: {
        状态: ['有效', '停用', '待激活'],
      },
      formats: {
        客户编号: { pattern: '^[A-Z]{2}-\\d{4}$', normalize: 'trim-upper', description: '两位大写字母-四位数字' },
        手机号: { pattern: '^1\\d{10}$', normalize: 'digits', description: '11 位手机号（去掉分隔符后校验）' },
        邮箱: { pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', normalize: 'trim-lower', description: '标准邮箱，去空白并小写' },
        地区: { pattern: '', normalize: 'trim', description: '去首尾空白' },
      },
    },
  }
}

/** 条件卡指纹：用于判断规则是否发生了实质变化，从而决定是否生成候选版本。 */
export function conditionCardSignature(card: ConditionCard): string {
  return digestOf(card)
}

/** 版本号序列：v1.0、v1.1、v1.2……候选版本只增不改。 */
export function nextVersionLabel(existing: RuleVersionSnapshot[]): string {
  if (existing.length === 0) {
    return 'v1.0'
  }
  const last = existing[existing.length - 1].version
  const matched = last.match(/^v(\d+)\.(\d+)$/)
  if (!matched) {
    return `v1.${existing.length}`
  }
  return `v${matched[1]}.${Number(matched[2]) + 1}`
}

type CleanseOutcome = {
  output: Record<string, string>
  code: string
  details: string[]
  quarantined: boolean
  absentReason: string
}

function isBlank(value: string, card: ConditionCard): boolean {
  return card.caliber.nullMarkers.includes(value.trim())
}

function normalizeField(field: string, value: string, card: ConditionCard): string {
  const rule = card.allowedRanges.formats[field]
  if (!rule) {
    return value
  }
  switch (rule.normalize) {
    case 'trim':
      return value.trim()
    case 'trim-upper':
      return value.trim().toUpperCase()
    case 'trim-lower':
      return value.trim().toLowerCase()
    case 'digits':
      return value.replace(/\D/g, '')
    default:
      return value
  }
}

/** 单样本清洗：先替换空值，再规范化格式，最后做范围、枚举与格式判定。 */
export function cleanseSample(sample: CleanseSample, card: ConditionCard): CleanseOutcome {
  const output: Record<string, string> = {}
  const details: string[] = []
  const issues: string[] = []
  let filled = false
  let formatted = false
  let quarantined = false
  let absentReason = ''

  for (const field of SAMPLE_FIELDS) {
    const rawValue = String(sample.values[field] ?? '')
    if (isBlank(rawValue, card)) {
      // 空值替换是口径内的合法结果：填充后不再套用该字段的范围/格式判定。
      output[field] = card.caliber.nullFill
      filled = true
      details.push(`${field} 为空值，替换为 ${card.caliber.nullFill}`)
      continue
    }
    const normalized = normalizeField(field, rawValue, card)
    if (normalized !== rawValue) {
      formatted = true
      details.push(`${field} 规范化为 ${normalized}`)
    }
    const formatRule = card.allowedRanges.formats[field]
    if (formatRule?.pattern && !new RegExp(formatRule.pattern).test(normalized)) {
      issues.push(`${field}=${normalized} 不符合格式「${formatRule.description}」`)
      quarantined = true
    }
    const numericRule = card.allowedRanges.numeric[field]
    if (numericRule) {
      const numeric = Number(normalized)
      if (!Number.isFinite(numeric)) {
        issues.push(`${field}=${normalized} 不是有效数值`)
        quarantined = true
      } else if (
        (numericRule.min !== null && numeric < numericRule.min) ||
        (numericRule.max !== null && numeric > numericRule.max)
      ) {
        issues.push(`${field}=${normalized} 超出允许范围 [${numericRule.min ?? '-∞'}, ${numericRule.max ?? '+∞'}]`)
        quarantined = true
      }
    }
    const enumValues = card.allowedRanges.enums[field]
    if (enumValues && !enumValues.includes(normalized)) {
      issues.push(`${field}=${normalized} 不在允许取值 ${enumValues.join('/')} 内`)
      quarantined = true
    }
    output[field] = normalized
  }

  if (isBlank(String(sample.values['客户编号'] ?? ''), card)) {
    quarantined = true
    issues.unshift('客户编号为空，缺少主键，无法进入输出流')
  }

  if (quarantined) {
    absentReason = issues.join('；')
  }

  let code = 'PASS'
  if (quarantined) {
    if (issues.some((item) => item.includes('格式'))) {
      code = 'FORMAT'
    }
    if (issues.some((item) => item.includes('范围'))) {
      code = 'RANGE'
    }
    if (issues.some((item) => item.includes('允许取值'))) {
      code = 'ENUM'
    }
    if (issues.some((item) => item.includes('主键'))) {
      code = 'FORMAT'
    }
  } else if (filled) {
    code = 'FILL'
  } else if (formatted) {
    code = 'FMT'
  }

  if (quarantined) {
    details.push(...issues)
  } else if (details.length === 0) {
    details.push('原值通过全部判定规则')
  }

  return { output, code, details, quarantined, absentReason }
}

function makeRowPassport(
  packageKey: string,
  ruleVersion: string,
  sample: CleanseSample,
  card: ConditionCard,
): RowPassport {
  const raw = Object.fromEntries(SAMPLE_FIELDS.map((field) => [field, String(sample.values[field] ?? '')]))
  const outcome = cleanseSample(sample, card)
  const sourceFingerprint = fingerprintOf(raw)
  const rowDigest = digestOf({
    packageKey,
    ruleVersion,
    rowNo: sample.rowNo,
    sourceFingerprint,
    code: outcome.code,
    output: outcome.output,
  })
  return {
    passportNo: passportNo('ROW', rowDigest),
    rowNo: sample.rowNo,
    sourceFingerprint,
    ruleVersion,
    decisionCode: outcome.code,
    decision: outcome.details.join('；'),
    status: outcome.quarantined ? 'quarantined' : 'stamped',
    absentReason: outcome.absentReason,
    output: outcome.output,
    raw,
    blocked: outcome.quarantined,
  }
}

function makeMissingRow(sample: CleanseSample, reason: string, ruleVersion: string): RowPassport {
  const raw = Object.fromEntries(SAMPLE_FIELDS.map((field) => [field, String(sample.values[field] ?? '')]))
  return {
    passportNo: '',
    rowNo: sample.rowNo,
    sourceFingerprint: fingerprintOf(raw),
    ruleVersion,
    decisionCode: 'UNSTAMPED',
    decision: reason,
    status: 'missing',
    absentReason: reason,
    output: {},
    raw,
    blocked: true,
  }
}

/** 内容哈希：只取决于包编号、原始样本、清洗版本与条件卡，与盖章时间/补齐次数无关。 */
export function contentDigestOf(
  packageKey: string,
  ruleVersion: string,
  card: ConditionCard,
  samples: CleanseSample[],
): string {
  return digestOf({
    packageKey,
    ruleVersion,
    card,
    samples: samples.map((sample) => ({ rowNo: sample.rowNo, values: sample.values })),
  })
}

export type BuildOptions = {
  interruptedRowNos?: number[]
  failReason?: string
}

/** 组装包护照：同一输入得到同一护照号；中断行只留下无护照的缺席记录。 */
export function buildPackagePassport(
  input: CleanseInput,
  snapshot: RuleVersionSnapshot,
  createdAt: string,
  options: BuildOptions = {},
): PackagePassport {
  const card = snapshot.conditionCard
  const interrupted = new Set(options.interruptedRowNos ?? [])
  const reason = options.failReason ?? '盖章过程被中断，本行未完成护照签发'
  const rows = input.samples.map((sample) =>
    interrupted.has(sample.rowNo)
      ? makeMissingRow(sample, reason, snapshot.version)
      : makeRowPassport(input.packageKey, snapshot.version, sample, card),
  )
  const digest = contentDigestOf(input.packageKey, snapshot.version, card, input.samples)
  const passport: PackagePassport = {
    passportNo: passportNo('PKG', digest),
    inputId: input.id,
    packageKey: input.packageKey,
    contentDigest: digest,
    ruleId: snapshot.ruleId,
    ruleCode: snapshot.ruleCode,
    ruleVersion: snapshot.version,
    inputTable: snapshot.inputTable,
    outputTable: snapshot.outputTable,
    source: input.source,
    conditionCard: card,
    totalRows: rows.length,
    stampedRows: rows.filter((row) => row.status === 'stamped').length,
    quarantinedRows: rows.filter((row) => row.status === 'quarantined').length,
    missingRows: rows.filter((row) => row.status === 'missing').length,
    blocked: false,
    blockReasons: [],
    complete: false,
    createdAt,
    firstCreatedAt: createdAt,
    rows,
    trace: [
      {
        at: createdAt,
        action: options.interruptedRowNos?.length ? '盖章（部分失败）' : '盖章',
        actor: input.source,
        detail: options.interruptedRowNos?.length
          ? `按清洗版本 ${snapshot.version} 处理 ${rows.length} 个样本，${options.interruptedRowNos.length} 个样本未完成盖章：${options.interruptedRowNos
              .map((rowNo) => `#${rowNo}`)
              .join('、')}`
          : `按清洗版本 ${snapshot.version} 为 ${rows.length} 个样本签发护照`,
      },
    ],
  }
  return settlePassport(passport)
}

/** 补齐未盖章样本：只补 missing 行，已通过/已隔离行原样保留。 */
export function repairMissingRows(passport: PackagePassport, at: string, actor: string): PackagePassport {
  const card = passport.conditionCard
  const nextRows = passport.rows.map((row) => {
    if (row.status !== 'missing' || row.passportNo) {
      return row
    }
    const sample: CleanseSample = { rowNo: row.rowNo, values: row.raw }
    return makeRowPassport(passport.packageKey, passport.ruleVersion, sample, card)
  })
  const repairedPassport: PackagePassport = {
    ...passport,
    rows: nextRows,
    trace: [
      ...passport.trace,
      {
        at,
        action: '补齐',
        actor,
        detail: `为 ${passport.missingRows} 个未盖章样本补发护照，已通过行未重制`,
      },
    ],
  }
  return settlePassport(repairedPassport)
}

/** 依据行护照重算统计、阻断结论与完整性；任何一次变更后都调用它。 */
export function settlePassport(passport: PackagePassport): PackagePassport {
  const stampedRows = passport.rows.filter((row) => row.status === 'stamped').length
  const quarantinedRows = passport.rows.filter((row) => row.status === 'quarantined').length
  const missingRows = passport.rows.filter((row) => row.status === 'missing').length
  const settled = { ...passport, stampedRows, quarantinedRows, missingRows }
  const verdict = qualityVerdict(settled)
  return {
    ...settled,
    blocked: verdict.blocked,
    blockReasons: verdict.reasons,
    complete:
      missingRows === 0 &&
      settled.rows.every(
        (row) =>
          row.passportNo !== '' &&
          row.ruleVersion === settled.ruleVersion &&
          (row.status === 'stamped' || (row.status === 'quarantined' && row.absentReason !== '')),
      ),
  }
}

/** 质量校验：只看护照本身（指纹、版本、缺席理由、阈值与完整性），不看页面状态。 */
export function qualityVerdict(passport: PackagePassport): QualityVerdict {
  const checks: QualityCheck[] = []
  const reasons: string[] = []
  const total = passport.rows.length || 1
  const badRows = passport.rows.filter((row) => row.status !== 'stamped').length
  const anomalyRate = badRows / total
  const passRate = (total - badRows) / total
  const threshold = passport.conditionCard.thresholds.abnormalRate

  const missing = passport.rows.filter((row) => row.status === 'missing' || !row.passportNo)
  checks.push({
    key: 'complete',
    label: '护照完整性',
    result: missing.length ? 'block' : 'pass',
    detail: missing.length
      ? `${missing.length} 个样本未盖章：${missing.map((row) => `#${row.rowNo}`).join('、')}`
      : `${passport.rows.length} 个样本全部携带护照`,
  })
  if (missing.length) {
    reasons.push(`存在 ${missing.length} 个未盖章样本，不能作为完整护照包流转`)
  }

  const versionSet = new Set(passport.rows.map((row) => row.ruleVersion))
  const sameVersion = versionSet.size === 1 && versionSet.has(passport.ruleVersion)
  checks.push({
    key: 'version',
    label: '版本一致性',
    result: sameVersion ? 'pass' : 'block',
    detail: sameVersion
      ? `全部行护照均为 ${passport.ruleVersion}`
      : `行护照版本 ${[...versionSet].join('/')} 与包版本 ${passport.ruleVersion} 不一致`,
  })
  if (!sameVersion) {
    reasons.push('包内护照版本不一致，拒绝混版本流转')
  }

  const tampered = passport.rows.filter((row) => fingerprintOf(row.raw) !== row.sourceFingerprint)
  checks.push({
    key: 'fingerprint',
    label: '原始值指纹',
    result: tampered.length ? 'block' : 'pass',
    detail: tampered.length
      ? `${tampered.length} 行原始值与指纹不符：${tampered.map((row) => `#${row.rowNo}`).join('、')}`
      : '全部行原始值与盖章指纹一致',
  })
  if (tampered.length) {
    reasons.push('原始值指纹校验失败，疑似原始输入被改动')
  }

  const missingReason = passport.rows.filter(
    (row) => (row.status === 'quarantined' || row.status === 'missing') && !row.absentReason.trim(),
  )
  checks.push({
    key: 'absent',
    label: '缺席理由',
    result: missingReason.length ? 'block' : 'pass',
    detail: missingReason.length
      ? `${missingReason.length} 个留存样本没有缺席理由`
      : '全部隔离/未盖章样本均写明缺席理由',
  })
  if (missingReason.length) {
    reasons.push('有留存样本缺少缺席理由，护照不完整')
  }

  checks.push({
    key: 'anomaly',
    label: '异常率阈值',
    result: anomalyRate > threshold ? 'block' : anomalyRate > threshold * 0.8 ? 'warn' : 'pass',
    metric: '异常率',
    value: `${(anomalyRate * 100).toFixed(1)}%`,
    bound: `≤ ${(threshold * 100).toFixed(1)}%`,
    detail: `异常 ${badRows}/${passport.rows.length} 行，条件卡阈值 ${(threshold * 100).toFixed(1)}%`,
  })
  if (anomalyRate > threshold) {
    reasons.push(`异常率 ${(anomalyRate * 100).toFixed(1)}% 超过条件卡阈值 ${(threshold * 100).toFixed(1)}%`)
  }

  const blockedRows = passport.rows.filter((row) => row.blocked && row.status === 'stamped')
  checks.push({
    key: 'blocked-rows',
    label: '阻断一致性',
    result: blockedRows.length ? 'block' : 'pass',
    detail: blockedRows.length
      ? `${blockedRows.length} 行标记阻断但状态为已盖章`
      : '隔离行均未进入输出流，判定与状态一致',
  })
  if (blockedRows.length) {
    reasons.push('存在状态与阻断标记冲突的护照行')
  }

  return { blocked: reasons.length > 0, reasons, checks, anomalyRate, passRate }
}

/** 转换编排准入：只接受同一版本、完整、未阻断的护照包。 */
export function admissionVerdict(passport: PackagePassport | null, latestVersion: string | null): AdmissionVerdict {
  const checks: AdmissionVerdict['checks'] = []
  const reasons: string[] = []
  if (!passport) {
    return {
      accepted: false,
      reasons: ['没有找到包护照，不能进入转换编排'],
      checks: [{ label: '护照存在', ok: false, detail: '未找到护照' }],
    }
  }
  const quality = qualityVerdict(passport)
  const versionSet = new Set(passport.rows.map((row) => row.ruleVersion))
  const singleVersion = versionSet.size === 1 && versionSet.has(passport.ruleVersion)

  checks.push({
    label: '护照包存在',
    ok: true,
    detail: `${passport.passportNo}（${passport.packageKey}）`,
  })
  checks.push({
    label: '同一清洗版本',
    ok: singleVersion,
    detail: singleVersion ? `全部行护照为 ${passport.ruleVersion}` : `发现 ${[...versionSet].join('、')}`,
  })
  checks.push({
    label: '护照完整',
    ok: passport.complete,
    detail: passport.complete
      ? `${passport.stampedRows} 行盖章 / ${passport.quarantinedRows} 行隔离留存 / 0 行未盖章`
      : `未盖章 ${passport.missingRows} 行，需先补齐`,
  })
  checks.push({
    label: '质量未阻断',
    ok: !quality.blocked,
    detail: quality.blocked ? quality.reasons.join('；') : '质量校验通过',
  })
  checks.push({
    label: '条件卡快照随包',
    ok: Boolean(passport.conditionCard?.caliber?.note),
    detail: passport.conditionCard ? `阈值 ${(passport.conditionCard.thresholds.abnormalRate * 100).toFixed(1)}%` : '缺少条件卡',
  })
  checks.push({
    label: '包版本可回看',
    ok: latestVersion === null || Boolean(passport.ruleVersion),
    detail: latestVersion
      ? `当前规则版本 ${latestVersion}，本包固化 ${passport.ruleVersion}`
      : `规则无版本快照，本包固化 ${passport.ruleVersion}`,
  })

  for (const check of checks) {
    if (!check.ok) {
      reasons.push(`${check.label}：${check.detail}`)
    }
  }
  return { accepted: reasons.length === 0, reasons, checks }
}

/** 回看版本核对仍然以清洗加工为主对象：包护照固化版本 vs 规则当前版本。 */
export function reviewVersion(passport: PackagePassport, latestVersion: string | null): VersionReview {
  const match = latestVersion !== null && latestVersion === passport.ruleVersion
  return {
    packageVersion: passport.ruleVersion,
    currentVersion: latestVersion,
    match,
    snapshotRetained: Boolean(passport.conditionCard),
    note: match
      ? `本包固化清洗版本 ${passport.ruleVersion}，与清洗规则当前版本一致，可按原样还原。`
      : `本包固化清洗版本 ${passport.ruleVersion}，规则当前版本为 ${latestVersion ?? '未登记'}；回看以本包固化的清洗版本为准，旧包不受新版本影响。`,
  }
}

/** 还原原始输入：原始样本 + 本包固化的条件卡 + 处理轨迹。 */
export function restoreOriginalInput(
  passport: PackagePassport,
  input: CleanseInput | null,
): { packageKey: string; ruleVersion: string; card: ConditionCard; samples: CleanseSample[]; trace: PackagePassport['trace']; digest: string } {
  return {
    packageKey: passport.packageKey,
    ruleVersion: passport.ruleVersion,
    card: passport.conditionCard,
    samples:
      input?.samples ??
      passport.rows.map((row) => ({ rowNo: row.rowNo, values: { ...row.raw } })),
    trace: passport.trace,
    digest: passport.contentDigest,
  }
}

export function rawContentOf(passport: PackagePassport): string {
  return stableStringify({
    packageKey: passport.packageKey,
    ruleVersion: passport.ruleVersion,
    card: passport.conditionCard,
    samples: passport.rows.map((row) => ({ rowNo: row.rowNo, values: row.raw })),
  })
}

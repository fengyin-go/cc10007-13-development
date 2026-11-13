import type { EntryRow } from './types'

/** 条件卡：阈值、口径、判定规则与允许范围固定在同一张卡上，随清洗版本一起快照。 */
export type ConditionCard = {
  /** 阈值：累计异常行数占比超过该值即阻断整个包 */
  thresholds: {
    abnormalRate: number
  }
  /** 口径：空值如何替换、哪些值视为空值，以及本卡的口径说明 */
  caliber: {
    nullFill: string
    nullMarkers: string[]
    note: string
  }
  /** 判定规则：判定码与它对输出流的影响，展示用，同时与引擎行为一一对应 */
  decisionRules: { code: string; label: string; effect: string }[]
  /** 允许范围：数值区间、枚举取值与格式规范 */
  allowedRanges: {
    numeric: Record<string, { min: number | null; max: number | null }>
    enums: Record<string, string[]>
    formats: Record<string, { pattern: string; normalize: FormatNormalizer; description: string }>
  }
}

export type FormatNormalizer = 'trim' | 'trim-upper' | 'trim-lower' | 'digits'

export type RowPassportStatus = 'stamped' | 'quarantined' | 'missing'

/**
 * 行护照：每个进入输出流的行或者被隔离留存的样本都必须携带。
 * 未盖章（missing）的行没有护照号，补齐时只补这些行。
 */
export type RowPassport = {
  /** 行护照号；未盖章时为空字符串 */
  passportNo: string
  /** 来源样本在原始输入中的序号（1 起） */
  rowNo: number
  /** 原始值指纹：在盖章时对原始值计算，用于核对未被篡改 */
  sourceFingerprint: string
  /** 清洗版本：行护照只能属于一个清洗版本 */
  ruleVersion: string
  /** 判定码：PASS / FILL / FMT / RANGE / ENUM / FORMAT / UNSTAMPED */
  decisionCode: string
  /** 判定说明，逐项列出清洗动作 */
  decision: string
  status: RowPassportStatus
  /** 缺席理由：隔离样本和未盖章样本必须说明为何没有进入输出流 */
  absentReason: string
  /** 输出值（隔离样本保留规范化后的值，仅用于核对） */
  output: Record<string, string>
  /** 原始值，隔离后仍原样留存，便于还原 */
  raw: Record<string, string>
  /** 是否阻断本行输出 */
  blocked: boolean
}

/** 包护照：一次清洗处理对应一个包；同一个包重复处理时返回原护照号。 */
export type PackagePassport = {
  passportNo: string
  /** 对应的清洗输入包 id，用于还原原始输入 */
  inputId: string
  /** 用户可见的包编号，重复处理按「包编号 + 清洗版本」命中 */
  packageKey: string
  /** 内容哈希：包编号 + 原始样本 + 清洗版本 + 条件卡，不含盖章时间 */
  contentDigest: string
  ruleId: number
  ruleCode: string
  /** 清洗版本 */
  ruleVersion: string
  inputTable: string
  outputTable: string
  source: string
  /** 本包固化的条件卡快照，后续改规则不会回写旧包 */
  conditionCard: ConditionCard
  totalRows: number
  stampedRows: number
  quarantinedRows: number
  missingRows: number
  blocked: boolean
  blockReasons: string[]
  /** 所有样本都已盖章且没有缺席 */
  complete: boolean
  createdAt: string
  firstCreatedAt: string
  rows: RowPassport[]
  /** 处理轨迹：每次处理、重复提交、补齐都会追加，不覆盖历史 */
  trace: PackageTrace[]
}

export type PackageTrace = {
  at: string
  action: string
  actor: string
  detail: string
}

/** 清洗样本包：只保存原始输入，护照由清洗生成。 */
export type CleanseSample = {
  rowNo: number
  values: Record<string, string>
}

export type CleanseInput = {
  id: string
  packageKey: string
  ruleId: number
  samples: CleanseSample[]
  submittedAt: string
  source: string
  /** 首次盖章时要模拟中断的行号；只影响首次处理，不进入内容哈希 */
  failRowNos?: number[]
  failReason?: string
}

export type PassportStore = {
  schema: number
  initialized: boolean
  inputs: Record<string, CleanseInput>
  passports: Record<string, PackagePassport>
  /** `${packageKey}::${ruleVersion}` -> 护照号，重复处理直接命中 */
  keyIndex: Record<string, string>
  /** ruleId -> 版本列表（按创建顺序） */
  versions: Record<string, RuleVersionSnapshot[]>
  /** 已接收进转换编排的包及接收时间 */
  accepted: Record<string, { at: string; actor: string }>
}

/** 清洗版本快照：候选版本只能生成新护照，旧版本与旧包永远保留。 */
export type RuleVersionSnapshot = {
  version: string
  ruleId: number
  ruleCode: string
  inputTable: string
  outputTable: string
  nullHandling: string
  formatCheck: string
  abnormalThreshold: string
  conditionCard: ConditionCard
  createdAt: string
  /** 新包只能选择 active 版本；旧包仍可凭快照还原 */
  active: boolean
}

export type QualityCheck = {
  key: string
  label: string
  result: 'pass' | 'warn' | 'block'
  detail: string
  metric?: string
  value?: number | string
  bound?: number | string
}

export type QualityVerdict = {
  blocked: boolean
  reasons: string[]
  checks: QualityCheck[]
  anomalyRate: number
  passRate: number
}

export type AdmissionCheck = { label: string; ok: boolean; detail: string }

export type AdmissionVerdict = {
  accepted: boolean
  reasons: string[]
  checks: AdmissionCheck[]
}

export type VersionReview = {
  packageVersion: string
  currentVersion: string | null
  match: boolean
  snapshotRetained: boolean
  note: string
}

export type ActionResultWithPassport = {
  ok: boolean
  message: string
  passport?: PackagePassport
  reused?: boolean
}

export type CleanseRuleRow = EntryRow

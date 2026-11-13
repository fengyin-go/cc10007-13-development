import { qualityVerdict } from '@/data/cleanse-engine'
import { allPassports, passportStore } from '@/data/cleanse-ledger'
import type { PackagePassport, QualityVerdict } from '@/data/cleanse-passport.types'

/** 质量校验的对象是护照包：阻断结论完全由护照本身计算，不依赖页面上的规则行状态。 */
export type PassportQualityRow = {
  passport: PackagePassport
  verdict: QualityVerdict
  accepted: boolean
}

export function listQualityByPassports(ruleId?: number): PassportQualityRow[] {
  const accepted = passportStore().accepted
  return allPassports()
    .filter((passport) => ruleId === undefined || passport.ruleId === ruleId)
    .sort((a, b) => a.packageKey.localeCompare(b.packageKey) || a.ruleVersion.localeCompare(b.ruleVersion))
    .map((passport) => ({
      passport,
      verdict: qualityVerdict(passport),
      accepted: Boolean(accepted[passport.passportNo]),
    }))
}

export function qualitySummary(ruleId?: number): {
  total: number
  blocked: number
  passed: number
  missingRows: number
  avgAnomalyRate: number
} {
  const rows = listQualityByPassports(ruleId)
  const total = rows.length
  const blocked = rows.filter((row) => row.verdict.blocked).length
  const missingRows = rows.reduce((sum, row) => sum + row.passport.missingRows, 0)
  const avgAnomalyRate = total ? rows.reduce((sum, row) => sum + row.verdict.anomalyRate, 0) / total : 0
  return { total, blocked, passed: total - blocked, missingRows, avgAnomalyRate }
}

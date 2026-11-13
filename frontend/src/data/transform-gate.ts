import { admissionVerdict, qualityVerdict } from '@/data/cleanse-engine'
import { allPassports, passportStore } from '@/data/cleanse-ledger'
import type { AdmissionVerdict, PackagePassport, QualityVerdict } from '@/data/cleanse-passport.types'

/**
 * 转换编排准入闸门：只看护照账本，不依赖页面状态，避免与 local-service 形成循环依赖。
 * 输入表若由清洗加工产出（存在对应的输出表护照包），则必须已有同一版本的完整护照包被接收。
 */
export function transformGate(inputTable: string): { ok: boolean; message: string } {
  const table = String(inputTable ?? '').trim()
  if (!table) {
    return { ok: true, message: '' }
  }
  const candidates = allPassports().filter((item) => item.outputTable === table)
  if (!candidates.length) {
    return { ok: true, message: '' }
  }
  const accepted = candidates.filter((item) => passportStore().accepted[item.passportNo])
  if (!accepted.length) {
    return {
      ok: false,
      message: `输入表 ${table} 由清洗加工产出，转换编排只接受同一版本的完整护照包；请先在清洁加工页接收护照包`,
    }
  }
  const versions = new Set(accepted.map((item) => item.ruleVersion))
  if (versions.size > 1) {
    return {
      ok: false,
      message: `输入表 ${table} 存在多个清洗版本（${[...versions].join('、')}）的已接收护照包，无法确定编排版本`,
    }
  }
  const passport = accepted[0]
  const verdict = admissionVerdict(passport, passport.ruleVersion)
  if (!verdict.accepted) {
    return { ok: false, message: `护照包 ${passport.passportNo} 准入复核失败：${verdict.reasons.join('；')}` }
  }
  return { ok: true, message: `输入表 ${table} 已接收护照包 ${passport.passportNo}（${passport.ruleVersion}）` }
}

export function passportGateStatus(passport: PackagePassport): {
  quality: QualityVerdict
  admission: AdmissionVerdict
  accepted: boolean
} {
  const accepted = Boolean(passportStore().accepted[passport.passportNo])
  return {
    quality: qualityVerdict(passport),
    admission: admissionVerdict(passport, passport.ruleVersion),
    accepted,
  }
}

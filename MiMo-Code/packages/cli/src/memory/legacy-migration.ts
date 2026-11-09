import * as path from "path"
import { randomBytes } from "crypto"
import { parseMemoryDocument, serializeMemoryDocument, type MemoryDocument } from "./record-parse"
import { readRecordMeta, withRecordMeta, type RecordMetaRead } from "./record-meta"
import { deductRetracted } from "./retract-view"
import { readBudgetedSectionAwareText } from "../session/budgeted-read"
import { Token } from "../util"

export const LEGACY_MIGRATION_TAG = "legacy-v1"
export const DEFAULT_MEMORY_BUDGET_TOKENS = 10_000

export type MigrationSkipReason = "partial-metadata"

export interface MigrationReport {
  changed: boolean
  migratedRecords: number
  skippedPartial: number
  sourceRecordCount: number
  beforeTokens: number
  afterTokens: number
  beforeTruncated: boolean
  afterTruncated: boolean
  beforeCompleteVisibleRecords: number
  afterCompleteVisibleRecords: number
  beforeStructureOnly: boolean
  afterStructureOnly: boolean
}

export interface MigrationComputation {
  ok: true
  text: string
  report: MigrationReport
} | {
  ok: false
  error: string
}

export interface MigrationOptions {
  now: string
  generateId: () => string
  budgetTokens?: number
  filePath: string
  tombstoneRaw?: string
}

function canonicalProjectPath(filepath: string): { projectID: string; target: string } | null {
  const target = path.resolve(filepath)
  const projectsRoot = path.resolve(process.env.MIMOCODE_DATA_DIR ?? "", "memory", "projects")
  if (projectsRoot === path.resolve("memory", "projects")) return null
  const relative = path.relative(projectsRoot, target)
  const parts = relative.split(path.sep)
  if (parts.length !== 2 || parts[1] !== "MEMORY.md" || !parts[0]) return null
  if (parts.some((part) => part === ".." || part.includes(path.sep))) return null
  return { projectID: parts[0], target }
}

function markerlessIds(raw: string): { ids: Set<string>; malformed: boolean } {
  const doc = parseMemoryDocument(raw)
  const ids = new Set<string>()
  let malformed = false
  for (const segment of doc.segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") malformed = true
    if (read.status === "valid" && read.meta.record_id) ids.add(read.meta.record_id)
  }
  return { ids, malformed }
}

function completeVisibleRecords(raw: string, budgetText: string): number {
  const doc = parseMemoryDocument(raw)
  return doc.segments.filter((segment) => segment.kind === "record" && segment.text.length > 0 && budgetText.includes(segment.text)).length
}

function structureOnly(raw: string, budgetTokens: number): boolean {
  const doc = parseMemoryDocument(raw)
  const { sections } = (() => {
    const lines = raw.split("\n")
    const headers: string[] = []
    let inSection = false
    for (const line of lines) {
      if (line.startsWith("## ")) {
        headers.push(line)
        inSection = true
      } else if (!inSection) {
        headers.push(line)
      }
    }
    return { sections: headers }
  })()
  void doc
  const estimate = Token.estimate(sections.join("\n"))
  return estimate >= budgetTokens
}

export function computeLegacyMigration(raw: string, tombstoneRaw: string, options: MigrationOptions): MigrationComputation {
  const beforeView = deductRetracted(raw, tombstoneRaw)
  const beforeBudget = readBudgetedSectionAwareText(beforeView.text, options.budgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS, options.filePath)
  const beforeComplete = completeVisibleRecords(beforeView.text, beforeBudget.text)

  const sourceDoc = parseMemoryDocument(raw)
  const existing = new Set<string>()
  for (const segment of sourceDoc.segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") {
      return { ok: false, error: `Legacy migration refused: malformed metadata at MEMORY.md line ${segment.line}.` }
    }
    if (read.status === "valid" && read.meta.record_id) {
      if (existing.has(read.meta.record_id))
        return { ok: false, error: `Legacy migration refused: duplicate record_id '${read.meta.record_id}' in MEMORY.md at line ${segment.line}.` }
      existing.add(read.meta.record_id)
    } else if (read.diagnostics.length > 0) {
      return { ok: false, error: `Legacy migration refused: metadata diagnostic at MEMORY.md line ${segment.line}.` }
    }
  }

  const tomb = markerlessIds(tombstoneRaw)
  if (tomb.malformed) return { ok: false, error: "Legacy migration refused: malformed metadata in retracted.md." }
  for (const id of tomb.ids) existing.add(id)

  const used = new Set(existing)
  let migratedRecords = 0
  let skippedPartial = 0
  let textChanged = false

  const segments = sourceDoc.segments.map((segment) => {
    if (segment.kind !== "record") return segment
    const read = readRecordMeta(segment)
    if (read.status === "valid") {
      skippedPartial +=
        read.meta.record_id === undefined || read.meta.recorded_at === undefined || read.meta.source_type === undefined ? 1 : 0
      return segment
    }

    let id = options.generateId()
    while (!id || used.has(id)) id = options.generateId()
    used.add(id)

    const stamped = withRecordMeta(segment, {
      record_id: id,
      recorded_at: options.now,
      source_type: "model_inference",
      extras: { mig: LEGACY_MIGRATION_TAG },
    })
    if (!stamped.ok) throw new Error(`Legacy migration failed at MEMORY.md line ${segment.line}.`)
    migratedRecords++
    textChanged ||= stamped.changed
    return { ...segment, text: stamped.text }
  })

  const candidate = serializeMemoryDocument({ segments })
  const afterView = deductRetracted(candidate, tombstoneRaw)
  const afterBudget = readBudgetedSectionAwareText(afterView.text, options.budgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS, options.filePath)
  const afterComplete = completeVisibleRecords(afterView.text, afterBudget.text)
  const beforeTruncated = beforeBudget.truncated
  const afterTruncated = afterBudget.truncated
  const beforeStructureOnly = structureOnly(beforeView.text, options.budgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS)
  const afterStructureOnly = structureOnly(afterView.text, options.budgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS)

  if (!beforeTruncated && afterTruncated)
    return { ok: false, error: `Legacy migration refused: metadata would introduce new memory truncation (before=${beforeBudget.totalTokens}, after=${afterBudget.totalTokens}).` }
  if (afterComplete < beforeComplete)
    return { ok: false, error: `Legacy migration refused: complete-visible records would decrease (${beforeComplete} -> ${afterComplete}).` }

  return {
    ok: true,
    text: candidate,
    report: {
      changed: textChanged,
      migratedRecords,
      skippedPartial,
      sourceRecordCount: sourceDoc.segments.filter((s) => s.kind === "record").length,
      beforeTokens: beforeBudget.totalTokens,
      afterTokens: afterBudget.totalTokens,
      beforeTruncated,
      afterTruncated,
      beforeCompleteVisibleRecords: beforeComplete,
      afterCompleteVisibleRecords: afterComplete,
      beforeStructureOnly,
      afterStructureOnly,
    },
  }
}

export function canonicalProjectMemoryPath(filepath: string, dataRoot: string): string | null {
  const target = path.resolve(filepath)
  const projectsRoot = path.resolve(dataRoot, "memory", "projects")
  const relative = path.relative(projectsRoot, target)
  const parts = relative.split(path.sep)
  if (parts.length !== 2 || parts[1] !== "MEMORY.md" || !parts[0]) return null
  return target
}

export function newLegacyRecordId(): string {
  return randomBytes(6).toString("hex").slice(0, 8)
}

export function secondPrecisionUtc(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z")
}

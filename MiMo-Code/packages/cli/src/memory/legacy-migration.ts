import * as path from "path"
import { randomBytes } from "crypto"
import { parseMemoryDocument, serializeMemoryDocument } from "./record-parse"
import { readRecordMeta, withRecordMeta } from "./record-meta"
import { deductRetracted } from "./retract-view"
import { DEFAULT_MEMORY_BUDGET_TOKENS, readBudgetedSectionAwareText } from "../session/budgeted-read"

export const LEGACY_MIGRATION_TAG = "legacy-v1"

export interface MigrationReport {
  changed: boolean
  migratedRecords: number
  skippedPartial: number
  skippedDiagnostic: number
  sourceRecordCount: number
  budgetTokens: number
  beforeTokens: number
  afterTokens: number
  beforeTruncated: boolean
  afterTruncated: boolean
  beforeCompleteVisibleRecords: number
  afterCompleteVisibleRecords: number
  beforeStructureOnly: boolean
  afterStructureOnly: boolean
}

export type MigrationComputation =
  | { ok: true; text: string; report: MigrationReport }
  | { ok: false; error: string }

export interface MigrationOptions {
  now: string
  generateId: () => string
  budgetTokens?: number
  filePath: string
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
  return doc.segments.filter(
    (segment) => segment.kind === "record" && segment.text.length > 0 && budgetText.includes(segment.text),
  ).length
}

export function computeLegacyMigration(
  raw: string,
  tombstoneRaw: string,
  options: MigrationOptions,
): MigrationComputation {
  const budgetTokens = options.budgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS
  const beforeView = deductRetracted(raw, tombstoneRaw)
  const beforeBudget = readBudgetedSectionAwareText(beforeView.text, budgetTokens, options.filePath)
  const beforeComplete = completeVisibleRecords(beforeView.text, beforeBudget.text)

  const sourceDoc = parseMemoryDocument(raw)
  const existing = new Set<string>()

  // P1-1: preflight every existing source ID before any generated ID is requested.
  for (const segment of sourceDoc.segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") {
      return { ok: false, error: `Legacy migration refused: malformed metadata at MEMORY.md line ${segment.line}.` }
    }
    if (read.status === "valid" && read.meta.record_id) {
      if (existing.has(read.meta.record_id)) {
        return {
          ok: false,
          error: `Legacy migration refused: duplicate record_id '${read.meta.record_id}' in MEMORY.md at line ${segment.line}.`,
        }
      }
      existing.add(read.meta.record_id)
    }
  }

  // Existing tombstone IDs are reserved but retracted.md is never modified by T-e.
  const tomb = markerlessIds(tombstoneRaw)
  if (tomb.malformed) {
    return { ok: false, error: "Legacy migration refused: malformed metadata in retracted.md." }
  }
  for (const id of tomb.ids) existing.add(id)

  const used = new Set(existing)
  let migratedRecords = 0
  let skippedPartial = 0
  let skippedDiagnostic = 0
  let textChanged = false

  const segments = sourceDoc.segments.map((segment) => {
    if (segment.kind !== "record") return segment

    const read = readRecordMeta(segment)
    // A diagnostic (for example prose that mentions the marker syntax on a later line) is
    // not corruption: leave that record byte-identical and keep migrating the others. The
    // same record is skipped again on every run, so the migration stays idempotent.
    if (read.diagnostics.length > 0) {
      skippedDiagnostic++
      return segment
    }
    if (read.status === "valid") {
      if (
        read.meta.record_id === undefined ||
        read.meta.recorded_at === undefined ||
        read.meta.source_type === undefined
      ) {
        skippedPartial++
      }
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
    if (!stamped.ok) {
      throw new Error(`Legacy migration failed at MEMORY.md line ${segment.line}.`)
    }

    migratedRecords++
    textChanged ||= stamped.changed
    return { ...segment, text: stamped.text }
  })

  const candidate = serializeMemoryDocument({ segments })
  const afterView = deductRetracted(candidate, tombstoneRaw)
  const afterBudget = readBudgetedSectionAwareText(afterView.text, budgetTokens, options.filePath)
  const afterComplete = completeVisibleRecords(afterView.text, afterBudget.text)

  // M1: migration may never reduce the number of complete record segments visible
  // through the real injection pipeline. Also reject a newly introduced truncation
  // when the old document was fully injectable.
  if (!beforeBudget.truncated && afterBudget.truncated) {
    return {
      ok: false,
      error:
        `Legacy migration refused: metadata would introduce new memory truncation ` +
        `(budget=${budgetTokens}, before=${beforeBudget.totalTokens}, after=${afterBudget.totalTokens} tokens). ` +
        `Trim about ${Math.max(0, afterBudget.totalTokens - budgetTokens)} tokens from MEMORY.md, then retry.`,
    }
  }
  if (afterComplete < beforeComplete) {
    return {
      ok: false,
      error:
        `Legacy migration refused: complete-visible records would decrease (${beforeComplete} -> ${afterComplete}; ` +
        `budget=${budgetTokens}, before=${beforeBudget.totalTokens}, after=${afterBudget.totalTokens} tokens). ` +
        `Trim about ${Math.max(0, afterBudget.totalTokens - beforeBudget.totalTokens)} tokens from MEMORY.md, then retry.`,
    }
  }

  return {
    ok: true,
    text: candidate,
    report: {
      changed: textChanged,
      migratedRecords,
      skippedPartial,
      skippedDiagnostic,
      budgetTokens,
      sourceRecordCount: sourceDoc.segments.filter((s) => s.kind === "record").length,
      beforeTokens: beforeBudget.totalTokens,
      afterTokens: afterBudget.totalTokens,
      beforeTruncated: beforeBudget.truncated,
      afterTruncated: afterBudget.truncated,
      beforeCompleteVisibleRecords: beforeComplete,
      afterCompleteVisibleRecords: afterComplete,
      beforeStructureOnly: beforeBudget.structureOnly === true,
      afterStructureOnly: afterBudget.structureOnly === true,
    },
  }
}

export function canonicalProjectMemoryPath(filepath: string, dataRoot: string): string | null {
  const target = path.resolve(filepath)
  const projectsRoot = path.resolve(dataRoot, "memory", "projects")
  const relative = path.relative(projectsRoot, target)
  // On Windows a target on another drive comes back as an absolute path, which would
  // otherwise split into ["D:", "MEMORY.md"] and look like a project directory.
  if (path.isAbsolute(relative)) return null
  const parts = relative.split(path.sep)
  if (parts.length !== 2 || parts[1] !== "MEMORY.md" || !parts[0]) return null
  if (parts[0] === "." || parts[0] === "..") return null
  return target
}

export function newLegacyRecordId(): string {
  return randomBytes(6).toString("hex").slice(0, 8)
}

export function secondPrecisionUtc(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function formatMigrationReport(report: MigrationReport, mode: { dryRun: boolean; written: boolean }): string {
  const head = mode.dryRun
    ? `Legacy migration dry-run: ${report.migratedRecords} records would receive metadata; no file was written.`
    : mode.written
      ? `Legacy migration completed: ${report.migratedRecords} legacy records migrated.`
      : "Legacy migration is already converged; no file changes were needed."
  return [
    head,
    `records=${report.sourceRecordCount} migrated=${report.migratedRecords} skippedPartial=${report.skippedPartial} skippedDiagnostic=${report.skippedDiagnostic}`,
    `budget=${report.budgetTokens} tokens: before=${report.beforeTokens} after=${report.afterTokens}`,
    `truncated: before=${report.beforeTruncated} after=${report.afterTruncated}; structureOnly: before=${report.beforeStructureOnly} after=${report.afterStructureOnly}`,
    `complete-visible records: before=${report.beforeCompleteVisibleRecords} after=${report.afterCompleteVisibleRecords}`,
    "src=i is the default low-trust source for migrated records, not evidence of model inference; mig=legacy-v1 marks at/src as synthesized.",
  ].join("\n")
}

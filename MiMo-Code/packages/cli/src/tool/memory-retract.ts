import * as path from "path"
import { Effect, Semaphore } from "effect"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Global } from "../global"
import { parseMemoryDocument, serializeMemoryDocument, type MemorySegment } from "../memory/record-parse"
import { readRecordMeta, withRecordMeta, type RecordRetractReason } from "../memory/record-meta"
import { assertWriteAllowed } from "./external-directory"
import type * as Tool from "./tool"

const locks = new Map<string, Semaphore.Semaphore>()

function lock(key: string) {
  const hit = locks.get(key)
  if (hit) return hit
  const next = Semaphore.makeUnsafe(1)
  locks.set(key, next)
  return next
}

function projectMemoryParts(filepath: string): { projectDir: string; tombstone: string } | null {
  const target = path.resolve(filepath)
  const projectsRoot = path.resolve(Global.Path.data, "memory", "projects")
  if (!target.startsWith(projectsRoot + path.sep) || path.basename(target) !== "MEMORY.md") return null
  const projectDir = path.dirname(target)
  if (projectDir === projectsRoot) return null
  return { projectDir, tombstone: path.join(projectDir, "retracted.md") }
}

function markerless(segment: MemorySegment): string {
  const read = readRecordMeta(segment)
  if (read.status === "malformed") throw new Error(`Malformed metadata at line ${segment.line}.`)
  if (read.status !== "valid") return segment.text
  const extras: Record<string, string | null> = {}
  for (const key of Object.keys(read.extras)) extras[key] = null
  const result = withRecordMeta(segment, {
    record_id: null,
    recorded_at: null,
    source_type: null,
    retracted_at: null,
    retract_reason: null,
    extras,
  })
  if (!result.ok) throw new Error(`Failed to strip metadata at line ${segment.line}.`)
  return result.text
}

function sameAssertionMetadata(
  source: ReturnType<typeof readRecordMeta>,
  tombstone: ReturnType<typeof readRecordMeta>,
): boolean {
  if (source.status !== "valid" || tombstone.status !== "valid") return false
  if (
    source.meta.record_id !== tombstone.meta.record_id ||
    source.meta.recorded_at !== tombstone.meta.recorded_at ||
    source.meta.source_type !== tombstone.meta.source_type
  ) {
    return false
  }
  const sourceKeys = Object.keys(source.extras)
  const tombKeys = Object.keys(tombstone.extras)
  if (sourceKeys.length !== tombKeys.length) return false
  return sourceKeys.every((key) => source.extras[key] === tombstone.extras[key])
}

function tombstoneMatchesSource(source: MemorySegment, tombstone: MemorySegment): boolean {
  const sourceRead = readRecordMeta(source)
  const tombRead = readRecordMeta(tombstone)
  if (sourceRead.status !== "valid" || tombRead.status !== "valid") return false
  if (sourceRead.meta.retracted_at !== undefined || sourceRead.meta.retract_reason !== undefined) return false
  if (tombRead.meta.retracted_at === undefined || tombRead.meta.retract_reason === undefined) return false
  return markerless(source) === markerless(tombstone) && sameAssertionMetadata(sourceRead, tombRead)
}

function alreadyConvergedFromTombstone(
  tombRaw: string,
  recordId: string,
  reason: RecordRetractReason,
): { retractedAt: string } | null {
  const tombDoc = parseMemoryDocument(tombRaw)
  const tombReads = tombDoc.segments
    .filter((segment) => segment.kind === "record")
    .map((segment) => ({ segment, read: readRecordMeta(segment) }))
  if (tombReads.some((item) => item.read.status === "malformed")) {
    throw new Error("Retract repair refused: malformed tombstone metadata.")
  }
  const tombMatches = tombReads.filter(
    (item) => item.read.status === "valid" && item.read.meta.record_id === recordId,
  )
  if (
    tombMatches.length === 1 &&
    tombMatches[0].read.meta.retract_reason === reason &&
    tombMatches[0].read.meta.retracted_at !== undefined
  ) {
    return { retractedAt: tombMatches[0].read.meta.retracted_at }
  }
  return null
}

function appendTombstone(existing: string, record: string): string {
  const header = "## Retracted records\n\n"
  if (existing.length === 0) return header + record + (record.endsWith("\n") ? "" : "\n")
  const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
  return existing + separator + record + (record.endsWith("\n") ? "" : "\n")
}

export const retractMemoryRecord = Effect.fn("Memory.retractRecord")(function* (input: {
  ctx: Tool.Context
  fs: AppFileSystem.Interface
  filepath: string
  recordId: string
  reason: RecordRetractReason
  assertWriteAllowedFn?: typeof assertWriteAllowed
}) {
  const parts = projectMemoryParts(input.filepath)
  if (!parts) {
    throw new Error(
      "T-c retract currently supports only canonical project MEMORY.md files; global retract is fail-closed until global IDs are stable.",
    )
  }

  const fs = input.fs
  const sourcePath = path.resolve(input.filepath)
  const tombstonePath = parts.tombstone

  const gate = input.assertWriteAllowedFn ?? assertWriteAllowed
  yield* gate(input.ctx, sourcePath)
  yield* gate(input.ctx, tombstonePath, { retract: true })

  return yield* lock(parts.projectDir).withPermits(1)(
    Effect.gen(function* () {
      const sourceExists = yield* fs.existsSafe(sourcePath)
      if (!sourceExists) {
        const tombRaw = (yield* fs.existsSafe(tombstonePath)) ? yield* fs.readFileString(tombstonePath) : ""
        const tombDoc = parseMemoryDocument(tombRaw)
        const tombReads = tombDoc.segments
          .filter((segment) => segment.kind === "record")
          .map((segment) => ({ segment, read: readRecordMeta(segment) }))
        if (tombReads.some((item) => item.read.status === "malformed")) {
          throw new Error("Retract repair refused: malformed tombstone metadata.")
        }
        const tombMatches = tombReads.filter(
          (item) => item.read.status === "valid" && item.read.meta.record_id === input.recordId,
        )
        if (
          tombMatches.length === 1 &&
          tombMatches[0].read.meta.retract_reason === input.reason &&
          tombMatches[0].read.meta.retracted_at !== undefined
        ) {
          return {
            sourcePath,
            tombstonePath,
            recordId: input.recordId,
            reason: input.reason,
            retractedAt: tombMatches[0].read.meta.retracted_at,
            alreadyConverged: true,
          }
        }
        throw new Error(`Source file not found: ${sourcePath}`)
      }
      const sourceRaw = yield* fs.readFileString(sourcePath)
      const sourceDoc = parseMemoryDocument(sourceRaw)
      const sourceRecords = sourceDoc.segments.filter((s) => s.kind === "record")
      const sourceReads = sourceRecords.map((segment) => ({ segment, read: readRecordMeta(segment) }))

      for (const item of sourceReads) {
        if (item.read.status === "malformed") {
          throw new Error(`Retract refused: malformed metadata at MEMORY.md line ${item.segment.line}.`)
        }
      }

      const matches = sourceReads.filter(
        (item) => item.read.status === "valid" && item.read.meta.record_id === input.recordId,
      )
      if (matches.length === 0) {
        const converged = alreadyConvergedFromTombstone(tombRaw, input.recordId, input.reason)
        if (converged) {
          return {
            sourcePath,
            tombstonePath,
            recordId: input.recordId,
            reason: input.reason,
            retractedAt: converged.retractedAt,
            alreadyConverged: true,
          }
        }
        throw new Error(`Retract refused: record_id '${input.recordId}' is not present in source MEMORY.md.`)
      }
      if (matches.length > 1) {
        throw new Error(`Retract refused: record_id '${input.recordId}' is duplicated in source MEMORY.md.`)
      }

      const tombRaw = (yield* fs.existsSafe(tombstonePath)) ? yield* fs.readFileString(tombstonePath) : ""
      const source = matches[0].segment
      const sourceMeta = matches[0].read
      if (sourceMeta.meta.retracted_at !== undefined || sourceMeta.meta.retract_reason !== undefined) {
        throw new Error("Retract refused: an active MEMORY.md record must not already carry retraction state.")
      }

      const tombDoc = parseMemoryDocument(tombRaw)
      const tombRecords = tombDoc.segments.filter((s) => s.kind === "record")
      const tombReads = tombRecords.map((segment) => ({ segment, read: readRecordMeta(segment) }))
      for (const item of tombReads) {
        if (item.read.status === "malformed") {
          throw new Error(`Retract refused: malformed tombstone metadata at retracted.md line ${item.segment.line}.`)
        }
      }

      const tombMatches = tombReads.filter(
        (item) => item.read.status === "valid" && item.read.meta.record_id === input.recordId,
      )
      if (tombMatches.length > 1) {
        throw new Error(`Retract refused: conflicting duplicate tombstones for record_id '${input.recordId}'.`)
      }

      if (tombMatches.length === 1) {
        const tomb = tombMatches[0]
        const tombMeta = tomb.read.meta
        if (tombMeta.retract_reason !== input.reason || tombMeta.retracted_at === undefined) {
          throw new Error(`Retract refused: existing tombstone for '${input.recordId}' conflicts with this assertion.`)
        }
        if (!tombstoneMatchesSource(source, tomb.segment)) {
          throw new Error(`Retract refused: existing tombstone for '${input.recordId}' does not match the source assertion.`)
        }
      }

      const retractedAt =
        tombMatches.length === 1 ? tombMatches[0].read.meta.retracted_at! : new Date().toISOString()

      // Phase 1: append the complete source record plus a retraction marker.
      const stamped = withRecordMeta(source, {
        retracted_at: retractedAt,
        retract_reason: input.reason,
      })
      if (!stamped.ok) {
        throw new Error(
          `Retract refused: could not create tombstone: ${stamped.diagnostics.map((d) => d.message).join("; ")}`,
        )
      }

      if (tombMatches.length === 0) {
        const nextTomb = appendTombstone(tombRaw, stamped.text)
        yield* fs.writeWithDirs(tombstonePath, nextTomb)
      }

      // Re-read and verify the tombstone before touching the source.
      const verifyRaw = yield* fs.readFileString(tombstonePath)
      const verifyDoc = parseMemoryDocument(verifyRaw)
      const verify = verifyDoc.segments
        .filter((s) => s.kind === "record")
        .map((segment) => ({ segment, read: readRecordMeta(segment) }))
        .filter((item) => item.read.status === "valid" && item.read.meta.record_id === input.recordId)
      if (verify.length !== 1) throw new Error("Retract refused: tombstone persistence verification failed.")
      if (markerless(verify[0].segment) !== markerless(source)) {
        throw new Error("Retract refused: persisted tombstone assertion mismatch.")
      }
      if (
        verify[0].read.meta.retracted_at !== retractedAt ||
        verify[0].read.meta.retract_reason !== input.reason
      ) {
        throw new Error("Retract refused: persisted tombstone metadata mismatch.")
      }

      // Final R verification: the tombstone remains the historical authority immediately
      // before source deletion. If it changed or disappeared, fail closed.
      const finalTombRaw = yield* fs.readFileString(tombstonePath)
      const finalTombDoc = parseMemoryDocument(finalTombRaw)
      const finalTombMatches = finalTombDoc.segments
        .filter((segment) => segment.kind === "record")
        .map((segment) => ({ segment, read: readRecordMeta(segment) }))
        .filter((item) => item.read.status === "valid" && item.read.meta.record_id === input.recordId)
      if (finalTombMatches.length !== 1 || !tombstoneMatchesSource(source, finalTombMatches[0].segment)) {
        throw new Error("Retract refused: tombstone changed or disappeared before source deletion.")
      }
      if (
        finalTombMatches[0].read.meta.retracted_at !== retractedAt ||
        finalTombMatches[0].read.meta.retract_reason !== input.reason
      ) {
        throw new Error("Retract refused: final tombstone metadata mismatch.")
      }

      // Phase 2: re-read the source and delete only the exact record captured above.
      const sourceNow = yield* fs.readFileString(sourcePath)
      const sourceNowDoc = parseMemoryDocument(sourceNow)
      const currentMatches = sourceNowDoc.segments.filter((segment) => {
        if (segment.kind !== "record") return false
        const read = readRecordMeta(segment)
        return read.status === "valid" && read.meta.record_id === input.recordId
      })
      if (currentMatches.length !== 1 || currentMatches[0].text !== source.text) {
        throw new Error("Retract refused: source changed after tombstone persistence; source was not deleted.")
      }

      const updated = serializeMemoryDocument({
        segments: sourceNowDoc.segments.map((segment) =>
          segment === currentMatches[0] ? { ...segment, text: "" } : segment,
        ),
      })
      yield* fs.writeWithDirs(sourcePath, updated)

      return {
        sourcePath,
        tombstonePath,
        recordId: input.recordId,
        reason: input.reason,
        retractedAt,
        alreadyConverged: false,
      }
    }),
  )
})

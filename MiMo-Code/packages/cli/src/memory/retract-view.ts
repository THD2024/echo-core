import { parseMemoryDocument, serializeMemoryDocument } from "./record-parse"
import { readRecordMeta } from "./record-meta"

export interface RetractViewResult {
  text: string
  deducted: string[]
  diagnostics: string[]
}

/**
 * Produce the model-visible view of an active MEMORY.md by subtracting records
 * whose record_id is currently represented by a valid tombstone.
 *
 * This is deliberately a pure read-side projection. It does not compare record
 * bodies: a valid tombstone for an id is sufficient to hide that id (fail-closed).
 */
export function deductRetracted(sourceRaw: string, tombRaw: string): RetractViewResult {
  const tombDoc = parseMemoryDocument(tombRaw)
  const sourceDoc = parseMemoryDocument(sourceRaw)
  const retracted = new Set<string>()
  const diagnostics: string[] = []

  for (const segment of tombDoc.segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") {
      diagnostics.push(`malformed tombstone metadata at line ${segment.line}`)
      continue
    }
    if (read.status !== "valid") continue
    const id = read.meta.record_id
    if (!id || read.meta.retracted_at === undefined || read.meta.retract_reason === undefined) continue
    if (retracted.has(id)) {
      diagnostics.push(`duplicate tombstone record_id: ${id}`)
      continue
    }
    retracted.add(id)
  }

  if (retracted.size === 0) return { text: sourceRaw, deducted: [], diagnostics }

  const deducted: string[] = []
  const escapeRegExp = (value: string) => value.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")

  for (const segment of sourceDoc.segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") {
      diagnostics.push(`malformed source metadata at line ${segment.line}`)
      // If a malformed carrier still contains an exact known retracted id,
      // hide it instead of failing open. This does not attempt to repair bytes.
      const firstLine = segment.text.split(/\r?\n/, 1)[0]
      for (const id of retracted) {
        const marker = new RegExp(
          "<!--m\\s[^>]*\\bid=" + escapeRegExp(id) + "(?:\\s|-->)",
        )
        if (marker.test(firstLine)) {
          segment.text = ""
          deducted.push(id)
          break
        }
      }
      continue
    }
    const id = read.status === "valid" ? read.meta.record_id : undefined
    if (!id || !retracted.has(id)) continue
    segment.text = ""
    deducted.push(id)
  }

  return {
    text: serializeMemoryDocument(sourceDoc),
    deducted,
    diagnostics,
  }
}

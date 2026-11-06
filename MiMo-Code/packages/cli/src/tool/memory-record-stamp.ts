import * as path from "path"
import { Effect } from "effect"
import { Global } from "../global"
import { stampMemoryRecords as stamp } from "../memory/record-identity"
import { randomBytes } from "node:crypto"

function isCanonicalMemoryFile(filepath: string): boolean {
  const target = path.resolve(filepath)
  const root = path.resolve(Global.Path.data, "memory", "projects")
  return target.startsWith(root + path.sep) && path.basename(target) === "MEMORY.md" && path.dirname(target) !== root
}

function nextId(): string {
  return randomBytes(6).toString("hex").slice(0, 8)
}

export function stampMemoryRecords(filepath: string, oldContent: string, newContent: string) {
  if (!isCanonicalMemoryFile(filepath)) return Effect.succeed(newContent)
  const now = new Date().toISOString()
  return Effect.try({
    try: () => {
      const result = stamp(oldContent, newContent, { generateId: nextId, now })
      if (!result.ok) throw new Error(result.error)
      return result.text
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

export const isCanonicalMemoryFilePath = isCanonicalMemoryFile

/**
 * Memory Formation Phase 1 — production evidence resolver + task-state reader (read-only SQLite / fs access).
 *
 * Booleans only: nothing read here is returned to the model or logged. Residual risk (accepted, documented):
 * existence / quote-substring answers form a read-only, bounded oracle over the local session DB and worktree files.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { Database, and, eq } from "../../storage"
import { MessageTable, PartTable, SessionTable, TodoTable } from "../../session/session.sql"
import type { Evidence, EvidenceResolver } from "./evidence"

const MAX_FILE_BYTES = 1024 * 1024

const rec = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === "object" ? (x as Record<string, unknown>) : undefined)

export function dbResolver(opts: { worktree?: string }): EvidenceResolver {
  const partOf = (session_id: string, message_id: string, part_id: string) =>
    Database.use((db) =>
      db
        .select({ data: PartTable.data })
        .from(PartTable)
        .where(and(eq(PartTable.id, part_id as never), eq(PartTable.message_id, message_id as never), eq(PartTable.session_id, session_id as never)))
        .get(),
    )
  return {
    // Contract: neither method throws. Any DB / fs error (missing file, bad path, locked DB) is "not found" => false.
    exists(e: Evidence): boolean {
      try {
        return existsUnsafe(e)
      } catch {
        return false
      }
    },
    quoteMatches(e, quote): boolean {
      try {
        return quoteUnsafe(e, quote)
      } catch {
        return false
      }
    },
  }

  function existsUnsafe(e: Evidence): boolean {
      switch (e.type) {
        case "user_message": {
          const row = Database.use((db) =>
            db
              .select({ data: MessageTable.data })
              .from(MessageTable)
              .where(and(eq(MessageTable.id, e.message_id as never), eq(MessageTable.session_id, e.session_id as never)))
              .get(),
          )
          return rec(row?.data)?.role === "user"
        }
        case "tool_result":
        case "command_result": {
          const row = partOf(e.session_id, e.message_id, e.part_id)
          return rec(row?.data)?.type === "tool"
        }
        case "system_event": {
          if (e.name !== "dream_run") return false
          const row = Database.use((db) =>
            db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, e.ref as never)).get(),
          )
          return !!row
        }
        case "file_range": {
          const root = opts.worktree
          if (!root) return false
          const abs = path.resolve(root, e.path)
          const rel = path.relative(path.resolve(root), abs)
          if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false
          const st = fs.lstatSync(abs)
          if (!st.isFile() || st.size > MAX_FILE_BYTES) return false
          const lines = fs.readFileSync(abs, "utf8").split("\n").length
          return e.end_line <= lines
        }
      }
  }

  function quoteUnsafe(e: Extract<Evidence, { type: "user_message" }>, quote: string): boolean {
      const rows = Database.use((db) =>
        db
          .select({ data: PartTable.data })
          .from(PartTable)
          .where(and(eq(PartTable.message_id, e.message_id as never), eq(PartTable.session_id, e.session_id as never)))
          .all(),
      )
      return rows.some((r) => {
        const d = rec(r.data)
        return d?.type === "text" && typeof d.text === "string" && d.text.includes(quote)
      })
  }
}

export function dbTaskState(sessionID: string): string[] {
  const rows = Database.use((db) =>
    db.select({ content: TodoTable.content }).from(TodoTable).where(eq(TodoTable.session_id, sessionID as never)).all(),
  )
  return rows.map((r) => r.content).filter((c): c is string => typeof c === "string").slice(0, 200)
}

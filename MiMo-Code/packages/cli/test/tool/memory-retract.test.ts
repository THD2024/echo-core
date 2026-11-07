import { describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"
import * as path from "path"
import { Global } from "../../src/global"

mock.module("../../src/tool/external-directory", () => ({
  assertWriteAllowed: () => Effect.void,
}))

const { retractMemoryRecord } = await import("../../src/tool/memory-retract")

const projectDir = path.join(Global.Path.data, "memory", "projects", "t-d3-test")
const sourcePath = path.join(projectDir, "MEMORY.md")
const tombstonePath = path.join(projectDir, "retracted.md")

const ctx = {
  agent: "build",
  sessionID: "test-session",
  messageID: "test-message",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} as any

function fakeFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    existsSafe: (file: string) => Effect.succeed(files.has(file)),
    readFileString: (file: string) => {
      const value = files.get(file)
      if (value === undefined) return Effect.fail(new Error(`missing file: ${file}`))
      return Effect.succeed(value)
    },
    writeWithDirs: (file: string, value: string) => {
      files.set(file, value)
      return Effect.void
    },
  } as any
}

const base = `## Facts\n\n- Alpha\n\n- Beta\n`
const stamped = `## Facts\n\n- Alpha <!--m id=alpha123 at=2026-11-07T10:00:00Z src=i-->\n\n- Beta <!--m id=beta123 at=2026-11-07T10:01:00Z src=i-->\n`
const tomb = `## Retracted records\n\n- Alpha <!--m id=alpha123 at=2026-11-07T10:00:00Z src=i ret=2026-11-07T10:02:00Z why=withdrawn-->\n`

function input(recordId = "alpha123") {
  return {
    ctx,
    fs: undefined as any,
    filepath: sourcePath,
    recordId,
    reason: "withdrawn" as const,
  }
}

describe("T-d.3 memory retract executor", () => {
  test("S+R rolls forward to R only and preserves other source bytes", async () => {
    const fs = fakeFs({ [sourcePath]: stamped, [tombstonePath]: tomb })
    const beforeBeta = "- Beta <!--m id=beta123 at=2026-11-07T10:01:00Z src=i-->\n"
    const result = await Effect.runPromise(retractMemoryRecord({ ...input(), fs }))
    expect(result.alreadyConverged).toBe(false)
    expect(fs.files.get(sourcePath)).toBe(
      `## Facts\n\n\n${beforeBeta}`,
    )
    expect(fs.files.get(tombstonePath)).toBe(tomb)
  })

  test("second call after record removal is idempotent", async () => {
    const fs = fakeFs({ [sourcePath]: `## Facts\n\n- Beta <!--m id=beta123 at=2026-11-07T10:01:00Z src=i-->\n`, [tombstonePath]: tomb })
    const result = await Effect.runPromise(retractMemoryRecord({ ...input(), fs }))
    expect(result.alreadyConverged).toBe(true)
    expect(result.retractedAt).toBe("2026-11-07T10:02:00Z")
  })

  test("diverged source and tombstone fail closed without writing", async () => {
    const divergentTomb = `## Retracted records\n\n- Different <!--m id=alpha123 at=2026-11-07T10:00:00Z src=i ret=2026-11-07T10:02:00Z why=withdrawn-->\n`
    const fs = fakeFs({ [sourcePath]: stamped, [tombstonePath]: divergentTomb })
    const beforeSource = fs.files.get(sourcePath)
    const beforeTomb = fs.files.get(tombstonePath)
    await expect(Effect.runPromise(retractMemoryRecord({ ...input(), fs }))).rejects.toThrow(/does not match/)
    expect(fs.files.get(sourcePath)).toBe(beforeSource)
    expect(fs.files.get(tombstonePath)).toBe(beforeTomb)
  })

  test("duplicate tombstone fails closed", async () => {
    const duplicate = tomb + "\n- Alpha <!--m id=alpha123 at=2026-11-07T10:00:00Z src=i ret=2026-11-07T10:02:00Z why=withdrawn-->\n"
    const fs = fakeFs({ [sourcePath]: stamped, [tombstonePath]: duplicate })
    await expect(Effect.runPromise(retractMemoryRecord({ ...input(), fs }))).rejects.toThrow(/conflicting duplicate/)
  })

  test("malformed tombstone fails closed without deleting source", async () => {
    const malformed = `## Retracted records\n\n- Alpha <!--m id=alpha123 at=bad src=i ret=2026-11-07T10:02:00Z why=withdrawn-->\n`
    const fs = fakeFs({ [sourcePath]: stamped, [tombstonePath]: malformed })
    const before = fs.files.get(sourcePath)
    await expect(Effect.runPromise(retractMemoryRecord({ ...input(), fs }))).rejects.toThrow(/malformed tombstone/)
    expect(fs.files.get(sourcePath)).toBe(before)
  })
})

import { describe, expect, test } from "bun:test"
import {
  authorizeCapabilityViews,
  CapabilityAccessError,
  CapabilityAuthorizationError,
  CapabilityDeclarationError,
  RuntimeContextExpiredError,
} from "../../src/echo-runtime/capability"

describe("authorizeCapabilityViews", () => {
  test("exposes only capabilities explicitly granted to each system", async () => {
    const filesystem = { readFile: () => "data" }
    const clock = { now: () => 123 }
    const views = await authorizeCapabilityViews({
      available: { filesystem, clock },
      declarations: [
        { systemId: "memory", requires: ["filesystem"] },
        { systemId: "model", requires: ["filesystem", "clock"] },
      ],
      authorize: ({ systemId, requested }) =>
        systemId === "memory" ? requested : requested.filter((id) => id === "clock"),
    })

    const memory = views.forSystem("memory")
    const model = views.forSystem("model")

    expect(memory.list()).toEqual(["filesystem"])
    expect(memory.get("filesystem")).toBe(filesystem)
    expect(memory.has("clock")).toBe(false)
    expect(model.list()).toEqual(["clock"])
    expect(model.get("clock")).toBe(clock)
    expect(() => model.get("filesystem")).toThrow(CapabilityAccessError)
  })

  test("does not invoke policy or grant implicitly when no capability is requested", async () => {
    let policyCalls = 0
    const views = await authorizeCapabilityViews({
      available: { filesystem: {} },
      declarations: [{ systemId: "empty", requires: [] }],
      authorize: () => {
        policyCalls++
        return ["filesystem"]
      },
    })

    expect(policyCalls).toBe(0)
    expect(views.forSystem("empty").list()).toEqual([])
  })

  test("rejects unknown requested capabilities before asking Host policy", async () => {
    let policyCalls = 0
    await expect(
      authorizeCapabilityViews({
        available: { filesystem: {} },
        declarations: [{ systemId: "memory", requires: ["network"] }],
        authorize: () => {
          policyCalls++
          return []
        },
      }),
    ).rejects.toThrow(CapabilityDeclarationError)
    expect(policyCalls).toBe(0)
  })

  test("rejects a Host policy that grants an undeclared capability", async () => {
    await expect(
      authorizeCapabilityViews({
        available: { filesystem: {}, network: {} },
        declarations: [{ systemId: "memory", requires: ["filesystem"] }],
        authorize: () => ["network"],
      }),
    ).rejects.toThrow(CapabilityAuthorizationError)
  })

  test("rejects duplicate system and capability declarations", async () => {
    const input = {
      available: { filesystem: {} },
      authorize: () => ["filesystem"],
    }

    await expect(
      authorizeCapabilityViews({
        ...input,
        declarations: [
          { systemId: "memory", requires: ["filesystem"] },
          { systemId: "memory", requires: [] },
        ],
      }),
    ).rejects.toThrow(CapabilityDeclarationError)

    await expect(
      authorizeCapabilityViews({
        ...input,
        declarations: [{ systemId: "memory", requires: ["filesystem", "filesystem"] }],
      }),
    ).rejects.toThrow(CapabilityDeclarationError)
  })

  test("invalidates every issued view when Runtime revokes the context", async () => {
    const views = await authorizeCapabilityViews({
      available: { filesystem: {} },
      declarations: [{ systemId: "memory", requires: ["filesystem"] }],
      authorize: ({ requested }) => requested,
    })
    const memory = views.forSystem("memory")

    views.revoke()

    expect(() => memory.has("filesystem")).toThrow(RuntimeContextExpiredError)
    expect(() => memory.get("filesystem")).toThrow(RuntimeContextExpiredError)
    expect(() => memory.list()).toThrow(RuntimeContextExpiredError)
  })

  test("rejects lookup for a system without a declaration", async () => {
    const views = await authorizeCapabilityViews({
      available: {},
      declarations: [],
      authorize: () => [],
    })

    expect(() => views.forSystem("memory")).toThrow(CapabilityDeclarationError)
  })

  test("rejects a Host policy that returns duplicate grants without silent dedup", async () => {
    let caught: unknown
    try {
      await authorizeCapabilityViews({
        available: { filesystem: {}, clock: {} },
        declarations: [{ systemId: "memory", requires: ["filesystem", "clock"] }],
        authorize: () => ["filesystem", "filesystem", "clock"],
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CapabilityAuthorizationError)
    const error = caught as CapabilityAuthorizationError
    expect(error.message).toContain('Host policy returned duplicate grant "filesystem"')
    expect(error.message).not.toContain('"clock"')
    expect(error.systemId).toBe("memory")
    expect(error.capabilityId).toBe("filesystem")
  })

  test("treats an empty Host grant for a non-empty request as explicit denial", async () => {
    let policyCalls = 0
    const views = await authorizeCapabilityViews({
      available: { filesystem: {}, clock: {} },
      declarations: [{ systemId: "memory", requires: ["filesystem", "clock"] }],
      authorize: () => {
        policyCalls++
        return []
      },
    })

    expect(policyCalls).toBe(1)
    const memory = views.forSystem("memory")
    expect(memory.list()).toEqual([])
    expect(memory.has("filesystem")).toBe(false)
    expect(() => memory.get("filesystem")).toThrow(CapabilityAccessError)
    expect(() => memory.get("clock")).toThrow(CapabilityAccessError)
  })

  test("authorizes the same capability independently for each system", async () => {
    const shared = { id: "shared" }
    const seen: Array<{ systemId: string; requested: readonly string[] }> = []
    const views = await authorizeCapabilityViews({
      available: { shared },
      declarations: [
        { systemId: "memory", requires: ["shared"] },
        { systemId: "model", requires: ["shared"] },
      ],
      authorize: (request) => {
        seen.push({ systemId: request.systemId, requested: request.requested })
        return request.systemId === "memory" ? request.requested : []
      },
    })

    expect(seen).toEqual([
      { systemId: "memory", requested: ["shared"] },
      { systemId: "model", requested: ["shared"] },
    ])
    expect(views.forSystem("memory").has("shared")).toBe(true)
    expect(views.forSystem("memory").get("shared")).toBe(shared)
    expect(views.forSystem("model").has("shared")).toBe(false)
    expect(() => views.forSystem("model").get("shared")).toThrow(CapabilityAccessError)
  })
})

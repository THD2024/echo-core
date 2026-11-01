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
})

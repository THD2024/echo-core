/**
 * Runtime-owned capability authorization.
 *
 * Host supplies the authorization policy; Runtime validates its decisions and
 * exposes only the capabilities granted to each declared system.
 *
 * This module deliberately contains no business routing or system lifecycle
 * orchestration. It is a small foundation primitive intended to be owned by
 * a Runtime instance.
 */

export type CapabilityId = string
export type SystemId = string
export type CapabilityBag = Readonly<Record<string, unknown>>

export interface CapabilityDeclaration {
  readonly systemId: SystemId
  readonly requires: readonly CapabilityId[]
}

export interface CapabilityAuthorizationRequest {
  readonly systemId: SystemId
  readonly requested: readonly CapabilityId[]
}

/**
 * The Host owns policy. Returning a subset is an explicit denial of the
 * remaining requested capabilities. There is intentionally no allow-all
 * default.
 */
export type CapabilityAuthorizer = (
  request: CapabilityAuthorizationRequest,
) => readonly CapabilityId[] | Promise<readonly CapabilityId[]>

export class CapabilityDeclarationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CapabilityDeclarationError"
  }
}

export class CapabilityAuthorizationError extends Error {
  constructor(
    message: string,
    readonly systemId: SystemId,
    readonly capabilityId?: CapabilityId,
  ) {
    super(message)
    this.name = "CapabilityAuthorizationError"
  }
}

export class CapabilityAccessError extends Error {
  constructor(
    readonly systemId: SystemId,
    readonly capabilityId: CapabilityId,
  ) {
    super(`System "${systemId}" is not authorized to access capability "${capabilityId}"`)
    this.name = "CapabilityAccessError"
  }
}

export class RuntimeContextExpiredError extends Error {
  constructor() {
    super("Runtime capability context is no longer active")
    this.name = "RuntimeContextExpiredError"
  }
}

export interface SystemCapabilityView<T extends object> {
  readonly systemId: SystemId
  has<K extends keyof T & string>(capabilityId: K): boolean
  get<K extends keyof T & string>(capabilityId: K): T[K]
  list(): readonly (keyof T & string)[]
}

export interface AuthorizedCapabilityViews<T extends object> {
  /**
   * Runtime/Core Assembly uses this to obtain the view it will pass to one
   * specific system. Systems should receive only their own returned view.
   */
  forSystem(systemId: SystemId): SystemCapabilityView<T>
  /** Invalidates every view created by this authorization operation. */
  revoke(): void
}

function assertIdentifier(value: string, kind: string): void {
  if (!value.trim()) {
    throw new CapabilityDeclarationError(`${kind} must not be empty`)
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * Creates isolated, system-scoped capability views.
 *
 * Unknown requested capabilities, duplicate declarations and policy
 * over-grants fail closed. A denied requested capability is simply omitted
 * from that system's view; attempting to access it throws.
 */
export async function authorizeCapabilityViews<T extends object>(input: {
  readonly available: T
  readonly declarations: readonly CapabilityDeclaration[]
  readonly authorize: CapabilityAuthorizer
}): Promise<AuthorizedCapabilityViews<T>> {
  const available = input.available as Readonly<Record<string, unknown>>
  const views = new Map<SystemId, SystemCapabilityView<T>>()
  const seenSystems = new Set<SystemId>()
  let active = true

  for (const declaration of input.declarations) {
    assertIdentifier(declaration.systemId, "System id")

    if (seenSystems.has(declaration.systemId)) {
      throw new CapabilityDeclarationError(
        `Duplicate capability declaration for system "${declaration.systemId}"`,
      )
    }
    seenSystems.add(declaration.systemId)

    const requested = [...declaration.requires]
    const seenCapabilities = new Set<CapabilityId>()

    for (const capabilityId of requested) {
      assertIdentifier(capabilityId, "Capability id")

      if (seenCapabilities.has(capabilityId)) {
        throw new CapabilityDeclarationError(
          `System "${declaration.systemId}" declares capability "${capabilityId}" more than once`,
        )
      }
      seenCapabilities.add(capabilityId)

      if (!hasOwn(available, capabilityId)) {
        throw new CapabilityDeclarationError(
          `System "${declaration.systemId}" requires unknown capability "${capabilityId}"`,
        )
      }
    }

    const request: CapabilityAuthorizationRequest = Object.freeze({
      systemId: declaration.systemId,
      requested: Object.freeze(requested),
    })

    const granted = requested.length === 0 ? [] : [...(await input.authorize(request))]
    const seenGrants = new Set<CapabilityId>()
    const scoped = Object.create(null) as Record<string, unknown>

    for (const capabilityId of granted) {
      if (seenGrants.has(capabilityId)) {
        throw new CapabilityAuthorizationError(
          `Host policy returned duplicate grant "${capabilityId}"`,
          declaration.systemId,
          capabilityId,
        )
      }
      seenGrants.add(capabilityId)

      if (!seenCapabilities.has(capabilityId)) {
        throw new CapabilityAuthorizationError(
          `Host policy attempted to grant undeclared capability "${capabilityId}"`,
          declaration.systemId,
          capabilityId,
        )
      }

      Object.defineProperty(scoped, capabilityId, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: available[capabilityId],
      })
    }

    const assertActive = () => {
      if (!active) throw new RuntimeContextExpiredError()
    }

    const view: SystemCapabilityView<T> = Object.freeze({
      systemId: declaration.systemId,
      has<K extends keyof T & string>(capabilityId: K) {
        assertActive()
        return hasOwn(scoped, capabilityId)
      },
      get<K extends keyof T & string>(capabilityId: K) {
        assertActive()
        if (!hasOwn(scoped, capabilityId)) {
          throw new CapabilityAccessError(declaration.systemId, capabilityId)
        }
        return scoped[capabilityId] as T[K]
      },
      list() {
        assertActive()
        return Object.freeze(Object.keys(scoped) as (keyof T & string)[])
      },
    })

    views.set(declaration.systemId, view)
  }

  return Object.freeze({
    forSystem(systemId: SystemId) {
      const view = views.get(systemId)
      if (!view) {
        throw new CapabilityDeclarationError(`No capability declaration exists for system "${systemId}"`)
      }
      return view
    },
    revoke() {
      active = false
    },
  })
}

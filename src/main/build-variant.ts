// Testnet and mainnet builds of one contract source (E64).
//
// A project's code marks its network parts with two macros that WAX Master defines when it
// compiles: WAXMASTER_TESTNET in the testnet build (WAX Testnet, other test networks and the
// local chain) and WAXMASTER_MAINNET in the mainnet build. Code inside `#ifdef WAXMASTER_TESTNET`
// is not compiled into the mainnet build at all, so it is in neither its WASM nor its ABI.
// Values that differ per network are set in one place with the same macros (for example a
// header with `#ifdef WAXMASTER_MAINNET ... #else ... #endif`). A project whose sources use
// neither macro has one build that fits every network.

import type { BuildVariant } from '../shared/api'
import type { NetworkKind } from '../shared/chain-types'

export type BuildFor = 'testnet' | 'mainnet'

export const VARIANT_MACRO: Record<BuildFor, string> = { testnet: 'WAXMASTER_TESTNET', mainnet: 'WAXMASTER_MAINNET' }

/** The build a network takes: mainnet for a mainnet, testnet for a test network and the local chain. */
export function buildForKind(kind: NetworkKind): BuildFor {
  return kind === 'mainnet' ? 'mainnet' : 'testnet'
}

/** True when any source line names one of the two macros (so the two builds differ). */
export function usesNetworkMacros(sources: { lines: string[] }[]): boolean {
  return sources.some((s) => s.lines.some((l) => l.includes(VARIANT_MACRO.testnet) || l.includes(VARIANT_MACRO.mainnet)))
}

/** The variant a build is: the network's when the sources use the macros, otherwise one for all. */
export function variantOf(uses: boolean, buildFor: BuildFor): BuildVariant {
  return uses ? buildFor : 'any'
}

/** The compiler flag of a variant; none for a build that fits every network. */
export function variantFlags(variant: BuildVariant): string[] {
  return variant === 'any' ? [] : [`-D${VARIANT_MACRO[variant]}`]
}

/** For a custom build command: what it is told about the build, as environment variables (it may pass the flag itself). */
export function variantEnv(buildFor: BuildFor): Record<string, string> {
  return { WAXMASTER_NETWORK: buildFor, WAXMASTER_BUILD_FLAG: `-D${VARIANT_MACRO[buildFor]}` }
}

/** A build may be deployed to a network when it fits every network or is that network's build. */
export function variantFits(variant: BuildVariant, buildFor: BuildFor): boolean {
  return variant === 'any' || variant === buildFor
}

export function variantLabel(variant: BuildVariant): string {
  return variant === 'any' ? 'one build for every network' : variant === 'mainnet' ? 'mainnet build' : 'testnet build'
}

// Values fixed at build time.

declare const __APP_COMMIT__: string
declare const __APP_STAGE__: number

export const BUILD_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev'
export const BUILD_STAGE: number = typeof __APP_STAGE__ === 'number' ? __APP_STAGE__ : 0

/**
 * Mainnet signing switch. Stays false in every stage build; it is switched on only
 * for the release build once the release criteria pass.
 */
export const MAINNET_SIGNING = false

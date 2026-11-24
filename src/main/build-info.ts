// Values fixed at build time.

declare const __APP_COMMIT__: string
declare const __APP_STAGE__: number
declare const __MAINNET_SIGNING__: boolean

export const BUILD_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev'
export const BUILD_STAGE: number = typeof __APP_STAGE__ === 'number' ? __APP_STAGE__ : 0

/**
 * Mainnet signing switch. Off in development builds; switched on only for a release that passes the release checks.
 */
export const MAINNET_SIGNING: boolean = typeof __MAINNET_SIGNING__ === 'boolean' ? __MAINNET_SIGNING__ : false

// Sets Electron fuses on the packaged executable.
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  const exe = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  })
}

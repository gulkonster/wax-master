Windows x64 installer for WAX Master.

Before installing, verify the file as described in the README section "Verify your download":

1. `Get-FileHash .\WAX-Master-Setup-<version>.exe -Algorithm SHA256` must equal the line for this file in `SHA256SUMS.txt`.
2. `gh attestation verify .\WAX-Master-Setup-<version>.exe -R gulkonster/wax-master` must pass.

The installer is not code-signed yet; Windows SmartScreen shows "Windows protected your PC". Choose "More info", then "Run anyway".

Updating from an earlier version: your projects, settings, keys and networks stay. The vault and the network list are converted to their new versions on first use, and one copy of each old file is kept in `%APPDATA%\WAX Master` (`vault.v1.bak.json`, `networks.v1.bak.json`). At the first unlock after the update the vault gets a recovery code: it is shown once in its own window; save it or write it down and keep it away from this computer.

Help > Documentation describes the recovery code, key backups, themes, the network list, what the app contacts and the example projects.

Windows x64 installer for WAX Master.

Before installing, verify the file as described in the README section "Verify your download":

1. `Get-FileHash .\WAX-Master-Setup-<version>.exe -Algorithm SHA256` must equal the line for this file in `SHA256SUMS.txt`.
2. `gh attestation verify .\WAX-Master-Setup-<version>.exe -R gulkonster/wax-master` must pass.

The installer is not code-signed yet; Windows SmartScreen shows "Windows protected your PC". Choose "More info", then "Run anyway".

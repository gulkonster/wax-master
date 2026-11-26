# Verify your download

An installer can be replaced on the way to you. Before the first use, check that the file you have is the one the project's public release workflow built. The official downloads are only on the project's GitHub releases page.

## How to do it here

From the app: when a new version is available, **Download and install** in the notice does the quick check below by itself. It downloads the installer and `SHA256SUMS.txt` of the same release from GitHub, compares the SHA-256, and installs only when they match; otherwise it deletes the file and says why. Before the installer starts, WAX Master saves your open files and closes; a running local chain is stopped first, after you agree. While it downloads, the notice shows the percentage and the time passed; **Cancel download** stops it. **Open the release page** is still there for the manual way.

By hand:

Quick check, with the hash:

1. Download `WAX-Master-Setup-<version>.exe` and `SHA256SUMS.txt` from the releases page.
2. In PowerShell, in the download folder, run the command below.
3. The hash must be the same as the line for this file in `SHA256SUMS.txt`.

```powershell
Get-FileHash .\WAX-Master-Setup-<version>.exe -Algorithm SHA256
```

Full check, with the build record (needs the GitHub CLI, `gh`):

```powershell
gh attestation verify .\WAX-Master-Setup-<version>.exe -R gulkonster/wax-master
```

A pass means this exact file was built by the project's release workflow from the tagged source. One changed byte makes it fail.

Help > Verify This Download opens the same steps on the project page (the app shows the address first).

## Example

`Get-FileHash` prints a 64-character hash. Compare the first and last eight characters with the line in `SHA256SUMS.txt`, then the whole value. If they differ, do not run the file; download it again from the releases page.

## What is needed

- PowerShell (part of Windows).
- For the full check: the GitHub CLI.

> Note: A pass proves where the file came from and which source it was built from. It does not prove the software has no bugs. The installers are not code-signed yet, so Windows SmartScreen shows "Windows protected your PC"; after the check, choose More info, then Run anyway.

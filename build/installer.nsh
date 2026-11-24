; Uninstall: remove the private toolchain distributions the app created.
; Projects and the key vault (%APPDATA%\WAX Master\vault.json) are kept.
; Installing a newer version runs the old uninstaller first; nothing is removed then.

!include LogicLib.nsh

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Removing WAX Master toolchains..."
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$env:WSL_UTF8=1; if (Test-Path $$env:SystemRoot\System32\wsl.exe) { & $$env:SystemRoot\System32\wsl.exe --list --quiet | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -like 'waxmaster-*' } | ForEach-Object { & $$env:SystemRoot\System32\wsl.exe --unregister $$_ } }"`
    RMDir /r "$LOCALAPPDATA\WAX Master\toolchains"
  ${endIf}
!macroend

; Uninstall: remove the private toolchain distributions the app created.
; Projects and the key vault (%APPDATA%\WAX Master\vault.json) are kept.
; Installing a newer version runs the old uninstaller first; nothing is removed then.
; The disks folder is deleted only when no waxmaster-* distribution is registered any more,
; so a failed unregister never leaves a registration without its disk.

!include LogicLib.nsh

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Removing WAX Master toolchains..."
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$env:WSL_UTF8=1; if (Test-Path $$env:SystemRoot\System32\wsl.exe) { & $$env:SystemRoot\System32\wsl.exe --list --quiet | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -like 'waxmaster-*' } | ForEach-Object { & $$env:SystemRoot\System32\wsl.exe --unregister $$_ } }"`
    Pop $0
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$env:WSL_UTF8=1; if (Test-Path $$env:SystemRoot\System32\wsl.exe) { $$left = @(& $$env:SystemRoot\System32\wsl.exe --list --quiet | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -like 'waxmaster-*' }); if ($$left.Count -gt 0) { exit 1 } }; exit 0"`
    Pop $0
    ${If} $0 == "0"
      RMDir /r "$LOCALAPPDATA\WAX Master\toolchains"
    ${Else}
      DetailPrint "A WAX Master toolchain is still registered in WSL; its folder was kept."
    ${EndIf}
  ${endIf}
!macroend

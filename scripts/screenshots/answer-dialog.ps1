# Answers a native dialog of WAX Master from Windows (UI Automation).
#
#   answer-dialog.ps1 -ProcessId <pid> -Title <title> -Button <name> [-TimeoutSec 30]
#     Finds a top-level window of the process whose title is exactly <title> (or a
#     dialog owned by one of its windows) and presses the button named <name>.
#     Exit code 0: pressed. Exit code 1: no such dialog or button within the time limit.
#
#   answer-dialog.ps1 -ProcessId <pid> -List
#     Prints the title of every open dialog (window class #32770) of the process, one per
#     line, and ends at once (exit code 0). Used to name a dialog nobody expected.
#
#   answer-dialog.ps1 -ProcessId <pid> -Title <title> -Focus [-TimeoutSec 30]
#     Brings the top-level window of the process with this exact title to the front and
#     gives it the keyboard focus (the confirmation window opens Approve only while it has
#     the focus). Exit code 0: it is the foreground window. Exit code 1: not within the limit.
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$Title = '',
  [string]$Button = '',
  [int]$TimeoutSec = 30,
  [switch]$List,
  [switch]$Focus
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$root = $A::RootElement
$byPid = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $ProcessId)
$dialogClass = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')

function Get-Candidates {
  $found = @()
  try { $tops = $root.FindAll($Scope::Children, $byPid) } catch { return $found }
  foreach ($w in $tops) {
    $found += $w
    # A message box with a parent window can sit below that window in the tree.
    try { $found += $w.FindAll($Scope::Children, $dialogClass) } catch {}
  }
  return $found
}

if ($List) {
  foreach ($w in Get-Candidates) {
    try { if ($w.Current.ClassName -eq '#32770') { $w.Current.Name } } catch {}
  }
  exit 0
}

if ($Focus) {
  if (-not $Title) { 'Title is needed.'; exit 1 }
  # Win32 directly: a window with a parent (the confirmation window) is not always in the automation tree.
  Add-Type -Name Fore -Namespace AnswerDialog -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, System.IntPtr l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
'@
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $script:found = [System.IntPtr]::Zero
    $cb = [AnswerDialog.Fore+EnumProc]{
      param($h, $l)
      $p = [uint32]0
      [AnswerDialog.Fore]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
      if ($p -eq $ProcessId -and [AnswerDialog.Fore]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 512
        [AnswerDialog.Fore]::GetWindowText($h, $sb, 512) | Out-Null
        if ($sb.ToString() -eq $Title) { $script:found = $h }
      }
      return $true
    }
    [AnswerDialog.Fore]::EnumWindows($cb, [System.IntPtr]::Zero) | Out-Null
    $h = $script:found
    if ($h -ne [System.IntPtr]::Zero) {
      if ([AnswerDialog.Fore]::GetForegroundWindow() -eq $h) { "'$Title' has the focus"; exit 0 }
      # Windows gives the foreground only to the program that made the last input: a key with no
      # meaning (virtual key 0x88, not assigned) is pressed and let go first. Nothing else is
      # attached to the window's input, which would leave the window in front but not active.
      [AnswerDialog.Fore]::keybd_event(0x88, 0, 0, [System.UIntPtr]::Zero)
      [AnswerDialog.Fore]::keybd_event(0x88, 0, 2, [System.UIntPtr]::Zero)
      [AnswerDialog.Fore]::ShowWindow($h, 5) | Out-Null
      [AnswerDialog.Fore]::SetForegroundWindow($h) | Out-Null
      Start-Sleep -Milliseconds 250
      if ([AnswerDialog.Fore]::GetForegroundWindow() -eq $h) { "'$Title' has the focus"; exit 0 }
    }
    Start-Sleep -Milliseconds 300
  }
  "'$Title' did not get the focus within $TimeoutSec s"
  exit 1
}

if (-not $Title -or -not $Button) { 'Title and Button are needed.'; exit 1 }

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  foreach ($w in Get-Candidates) {
    try { $name = $w.Current.Name } catch { continue }
    if ($name -ne $Title) { continue }
    $cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $Button)
    try { $b = $w.FindFirst($Scope::Descendants, $cond) } catch { $b = $null }
    if (-not $b) { continue }
    $pattern = $null
    if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke()
      "pressed '$Button' in '$Title'"
      exit 0
    }
    $handle = $b.Current.NativeWindowHandle
    if ($handle -ne 0) {
      Add-Type -Name User32 -Namespace AnswerDialog -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr SendMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'
      # BM_CLICK
      [AnswerDialog.User32]::SendMessage([System.IntPtr]$handle, 0x00F5, [System.IntPtr]::Zero, [System.IntPtr]::Zero) | Out-Null
      "pressed '$Button' in '$Title'"
      exit 0
    }
  }
  Start-Sleep -Milliseconds 300
}
"no dialog '$Title' with the button '$Button' within $TimeoutSec s"
exit 1

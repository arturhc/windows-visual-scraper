param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Url,
  [string]$Profile = 'Default',
  [long]$Handle,
  [int]$ProcessId,
  [string]$OutputPath,
  [string]$InputPath,
  [string]$Key,
  [int]$Repeat = 1,
  [int]$X,
  [int]$Y,
  [int]$ClickCount = 1,
  [double]$SearchRightRatio = 0.82,
  [int]$CropPadding = 8,
  [double]$CropLeftRatio,
  [double]$CropTopRatio,
  [double]$CropRightRatio,
  [double]$CropBottomRatio
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-CompactJson($Value) {
  $Value | ConvertTo-Json -Compress -Depth 8
}

function Get-EdgePath {
  $command = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
    return $command.Source
  }
  foreach ($candidate in @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw 'Microsoft Edge was not found.'
}

function Ensure-NativeTypes {
  if (-not ('VisualImageScraper.NativeMethods' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace VisualImageScraper {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public static class NativeMethods {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int Width, int Height, bool Repaint);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint message, UIntPtr wParam, IntPtr lParam);
  }
}
"@
  }
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
}

function Get-EdgeWindows {
  Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Sort-Object StartTime |
    ForEach-Object {
      [pscustomobject]@{
        processId = $_.Id
        handle = [int64]$_.MainWindowHandle
        title = [regex]::Replace($_.MainWindowTitle, '[\x00-\x1F\x7F]', ' ').Trim()
        started = $_.StartTime.ToString('o')
      }
    }
}

function Assert-Window([long]$WindowHandle) {
  Ensure-NativeTypes
  if ($WindowHandle -le 0 -or -not [VisualImageScraper.NativeMethods]::IsWindow([IntPtr]$WindowHandle)) {
    throw "Invalid window handle: $WindowHandle"
  }
}

function Get-WindowBounds([long]$WindowHandle) {
  Assert-Window $WindowHandle
  $rect = New-Object VisualImageScraper.RECT
  if (-not [VisualImageScraper.NativeMethods]::GetWindowRect([IntPtr]$WindowHandle, [ref]$rect)) {
    throw "Could not read window bounds for handle $WindowHandle."
  }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { throw "Window has invalid bounds: ${width}x${height}." }
  [pscustomobject]@{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom; width=$width; height=$height }
}

function Focus-Window([long]$WindowHandle, [int]$TargetProcessId) {
  Assert-Window $WindowHandle
  $pointer = [IntPtr]$WindowHandle
  [VisualImageScraper.NativeMethods]::ShowWindowAsync($pointer, 9) | Out-Null
  Start-Sleep -Milliseconds 100
  $shell = New-Object -ComObject WScript.Shell
  if ($TargetProcessId -gt 0) { try { $shell.AppActivate($TargetProcessId) | Out-Null } catch {} }
  [VisualImageScraper.NativeMethods]::SetForegroundWindow($pointer) | Out-Null
  Start-Sleep -Milliseconds 150
}

function Maximize-Window([long]$WindowHandle, [int]$TargetProcessId) {
  Focus-Window $WindowHandle $TargetProcessId
  $pointer = [IntPtr]$WindowHandle
  [VisualImageScraper.NativeMethods]::ShowWindowAsync($pointer, 3) | Out-Null
  Start-Sleep -Milliseconds 200
  $screen = [System.Windows.Forms.Screen]::FromHandle($pointer)
  $area = $screen.WorkingArea
  [VisualImageScraper.NativeMethods]::MoveWindow($pointer, $area.Left, $area.Top, $area.Width, $area.Height, $true) | Out-Null
  [VisualImageScraper.NativeMethods]::SetForegroundWindow($pointer) | Out-Null
  Start-Sleep -Milliseconds 180
}

function Send-WindowKey([long]$WindowHandle, [int]$TargetProcessId, [string]$WindowKey, [int]$WindowRepeat) {
  $keyMap = @{ HOME='{HOME}'; END='{END}'; PGDN='{PGDN}'; LEFT='{LEFT}'; RIGHT='{RIGHT}'; ESC='{ESC}'; ENTER='{ENTER}'; SPACE=' '; F11='{F11}' }
  $normalized = $WindowKey.ToUpperInvariant()
  if (-not $keyMap.ContainsKey($normalized)) { throw "Unsupported key: $WindowKey" }
  Focus-Window $WindowHandle $TargetProcessId
  $shell = New-Object -ComObject WScript.Shell
  for ($index = 0; $index -lt [Math]::Min(20, [Math]::Max(1, $WindowRepeat)); $index += 1) {
    $shell.SendKeys($keyMap[$normalized])
    Start-Sleep -Milliseconds 180
  }
}

function Click-WindowPoint([long]$WindowHandle, [int]$TargetProcessId, [int]$OffsetX, [int]$OffsetY, [int]$Times) {
  Focus-Window $WindowHandle $TargetProcessId
  $bounds = Get-WindowBounds $WindowHandle
  if ($OffsetX -lt 0 -or $OffsetX -ge $bounds.width -or $OffsetY -lt 0 -or $OffsetY -ge $bounds.height) {
    throw "Click point is outside the window: ($OffsetX,$OffsetY)."
  }
  $cursor = New-Object VisualImageScraper.POINT
  [VisualImageScraper.NativeMethods]::GetCursorPos([ref]$cursor) | Out-Null
  try {
    [VisualImageScraper.NativeMethods]::SetCursorPos($bounds.left + $OffsetX, $bounds.top + $OffsetY) | Out-Null
    Start-Sleep -Milliseconds 120
    for ($index = 0; $index -lt [Math]::Min(3, [Math]::Max(1, $Times)); $index += 1) {
      [VisualImageScraper.NativeMethods]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 40
      [VisualImageScraper.NativeMethods]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 150
    }
  } finally {
    [VisualImageScraper.NativeMethods]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
  }
}

function Save-WindowScreenshot([long]$WindowHandle, [string]$TargetPath) {
  Ensure-NativeTypes
  [VisualImageScraper.NativeMethods]::SetProcessDPIAware() | Out-Null
  $bounds = Get-WindowBounds $WindowHandle
  $directory = Split-Path -Parent $TargetPath
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $left = [Math]::Max($bounds.left, $virtual.Left)
  $top = [Math]::Max($bounds.top, $virtual.Top)
  $right = [Math]::Min($bounds.right, $virtual.Right)
  $bottom = [Math]::Min($bounds.bottom, $virtual.Bottom)
  if ($right -le $left -or $bottom -le $top) { throw 'Window is outside the visible desktop.' }
  $bitmap = New-Object System.Drawing.Bitmap($bounds.width, $bounds.height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Black)
    $size = New-Object System.Drawing.Size($right - $left, $bottom - $top)
    $graphics.CopyFromScreen($left, $top, $left - $bounds.left, $top - $bounds.top, $size)
    $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

function Test-ActiveColor([System.Drawing.Color]$Color) {
  $brightness = ($Color.R * 0.2126) + ($Color.G * 0.7152) + ($Color.B * 0.0722)
  $spread = ([Math]::Max($Color.R, [Math]::Max($Color.G, $Color.B))) - ([Math]::Min($Color.R, [Math]::Min($Color.G, $Color.B)))
  return $brightness -ge 28 -or $spread -ge 20
}

function Find-LongestBlock([bool[]]$Flags) {
  $bestStart = -1; $bestEnd = -1; $start = -1
  for ($index = 0; $index -lt $Flags.Length; $index += 1) {
    if ($Flags[$index] -and $start -lt 0) { $start = $index }
    if ((-not $Flags[$index] -or $index -eq $Flags.Length - 1) -and $start -ge 0) {
      $end = if ($Flags[$index]) { $index } else { $index - 1 }
      if (($end - $start) -gt ($bestEnd - $bestStart)) { $bestStart = $start; $bestEnd = $end }
      $start = -1
    }
  }
  if ($bestStart -lt 0) { return $null }
  return [pscustomobject]@{ start=$bestStart; end=$bestEnd }
}

function Save-HeuristicCrop([string]$SourcePath, [string]$TargetPath, [double]$RightRatio, [int]$Padding) {
  Ensure-NativeTypes
  $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
  try {
    $leftLimit = [Math]::Floor($source.Width * 0.03)
    $rightLimit = [Math]::Min($source.Width - 1, [Math]::Floor($source.Width * [Math]::Min(0.98, [Math]::Max(0.10, $RightRatio))))
    $topLimit = [Math]::Floor($source.Height * 0.06)
    $bottomLimit = [Math]::Floor($source.Height * 0.94)
    $columnFlags = New-Object bool[] ($rightLimit - $leftLimit + 1)
    $sampleStep = 4
    $minimumColumnHits = [Math]::Max(5, [Math]::Floor((($bottomLimit - $topLimit) / $sampleStep) * 0.08))
    for ($x = $leftLimit; $x -le $rightLimit; $x += 1) {
      $hits = 0
      for ($y = $topLimit; $y -le $bottomLimit; $y += $sampleStep) {
        if (Test-ActiveColor $source.GetPixel($x, $y)) { $hits += 1 }
      }
      $columnFlags[$x - $leftLimit] = $hits -ge $minimumColumnHits
    }
    $columns = Find-LongestBlock $columnFlags
    if (-not $columns) { throw 'Could not detect an active image region.' }
    $left = $leftLimit + $columns.start; $right = $leftLimit + $columns.end
    $rowFlags = New-Object bool[] ($bottomLimit - $topLimit + 1)
    $minimumRowHits = [Math]::Max(5, [Math]::Floor((($right - $left) / $sampleStep) * 0.10))
    for ($y = $topLimit; $y -le $bottomLimit; $y += 1) {
      $hits = 0
      for ($x = $left; $x -le $right; $x += $sampleStep) {
        if (Test-ActiveColor $source.GetPixel($x, $y)) { $hits += 1 }
      }
      $rowFlags[$y - $topLimit] = $hits -ge $minimumRowHits
    }
    $rows = Find-LongestBlock $rowFlags
    if (-not $rows) { throw 'Could not detect active image rows.' }
    $top = $topLimit + $rows.start; $bottom = $topLimit + $rows.end
    $left = [Math]::Max(0, $left - $Padding); $top = [Math]::Max(0, $top - $Padding)
    $right = [Math]::Min($source.Width - 1, $right + $Padding); $bottom = [Math]::Min($source.Height - 1, $bottom + $Padding)
    $width = $right - $left + 1; $height = $bottom - $top + 1
    if ($width -lt 40 -or $height -lt 40) { throw 'Detected crop is too small.' }
    $directory = Split-Path -Parent $TargetPath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $crop = $source.Clone((New-Object System.Drawing.Rectangle($left, $top, $width, $height)), $source.PixelFormat)
    try { $crop.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
  } finally { $source.Dispose() }
}

function Save-RatioCrop([string]$SourcePath, [string]$TargetPath, [double]$LeftRatio, [double]$TopRatio, [double]$RightRatio, [double]$BottomRatio, [int]$Padding) {
  Ensure-NativeTypes
  foreach ($ratio in @($LeftRatio, $TopRatio, $RightRatio, $BottomRatio)) {
    if ($ratio -lt 0 -or $ratio -gt 1) { throw 'Crop ratios must be from 0 through 1.' }
  }
  if ($RightRatio -le $LeftRatio -or $BottomRatio -le $TopRatio) { throw 'Crop ratios describe an empty region.' }
  $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
  try {
    $left = [Math]::Max(0, [Math]::Floor($source.Width * $LeftRatio) - $Padding)
    $top = [Math]::Max(0, [Math]::Floor($source.Height * $TopRatio) - $Padding)
    $right = [Math]::Min($source.Width - 1, [Math]::Ceiling($source.Width * $RightRatio) - 1 + $Padding)
    $bottom = [Math]::Min($source.Height - 1, [Math]::Ceiling($source.Height * $BottomRatio) - 1 + $Padding)
    $width = $right - $left + 1; $height = $bottom - $top + 1
    if ($width -lt 40 -or $height -lt 40) { throw 'Ratio crop is too small.' }
    $directory = Split-Path -Parent $TargetPath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $crop = $source.Clone((New-Object System.Drawing.Rectangle($left, $top, $width, $height)), $source.PixelFormat)
    try { $crop.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
  } finally { $source.Dispose() }
}

switch ($Action) {
  'doctor' { Ensure-NativeTypes; Write-CompactJson ([pscustomobject]@{ windows=$true; edgePath=(Get-EdgePath); powershell=$PSVersionTable.PSVersion.ToString() }) }
  'list-edge-windows' { Write-CompactJson (Get-EdgeWindows) }
  'open-edge' {
    $edgePath = Get-EdgePath
    $process = Start-Process -FilePath $edgePath -ArgumentList @("--profile-directory=$Profile", '--new-window', '--start-maximized', $Url) -PassThru
    Start-Sleep -Milliseconds 300
    Write-CompactJson ([pscustomobject]@{ processId=$process.Id })
  }
  'focus-window' { Focus-Window $Handle $ProcessId }
  'maximize-window' { Maximize-Window $Handle $ProcessId }
  'get-window-rect' { Write-CompactJson (Get-WindowBounds $Handle) }
  'send-key' { Send-WindowKey $Handle $ProcessId $Key $Repeat }
  'click-window' { Click-WindowPoint $Handle $ProcessId $X $Y $ClickCount }
  'capture-window' { Save-WindowScreenshot $Handle $OutputPath }
  'crop-photo' { Save-HeuristicCrop $InputPath $OutputPath $SearchRightRatio $CropPadding }
  'crop-photo-ratios' { Save-RatioCrop $InputPath $OutputPath $CropLeftRatio $CropTopRatio $CropRightRatio $CropBottomRatio $CropPadding }
  'close-window' {
    Ensure-NativeTypes
    if ($Handle -gt 0 -and [VisualImageScraper.NativeMethods]::IsWindow([IntPtr]$Handle)) {
      [VisualImageScraper.NativeMethods]::PostMessage([IntPtr]$Handle, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    }
  }
  default { throw "Unsupported action: $Action" }
}

<#
.SYNOPSIS
  Keeps tools/simulate_device.py running continuously, so a demo/deployment
  of the website keeps receiving fresh readings without anyone babysitting a
  terminal.

.DESCRIPTION
  simulate_device.py --live runs until you kill it or it hits an unhandled
  error (e.g. the website restarting, a momentary network blip). This wraps
  it in a restart loop: if the process exits for any reason, it's relaunched
  after a short delay, and everything it prints is appended to a log file so
  you can see what happened after the fact.

  This is meant for demo/development use over hours-to-days, not as a
  production service manager. For anything longer-lived, use a real process
  supervisor (NSSM, a scheduled task with "restart on failure", pm2, systemd)
  instead of a polling loop like this one.

.EXAMPLE
  .\tools\run_simulator_loop.ps1
  .\tools\run_simulator_loop.ps1 -Url http://192.168.1.50:3000 -Token my-secret
#>
param(
    [string]$Url = "http://127.0.0.1:3000",
    [string]$Token = "change-me",
    [string]$DeviceId = "gaitsense-sim01",
    [int]$RestartDelaySeconds = 5,
    [string]$LogFile = "$PSScriptRoot\simulator.log"
)

$python = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Output "Falling back to 'python' on PATH -- $python not found (venv not set up?)"
    $python = "python"
}

$script = Join-Path $PSScriptRoot "simulate_device.py"

Write-Output "Starting simulator loop -> $Url (device $DeviceId). Logging to $LogFile. Ctrl+C to stop."

while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$timestamp] starting simulate_device.py --live"

    & $python $script --url $Url --token $Token --device-id $DeviceId --live *>> $LogFile

    $exitTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$exitTime] simulate_device.py exited (code $LASTEXITCODE) -- restarting in ${RestartDelaySeconds}s"
    Write-Output "[$exitTime] simulator exited (code $LASTEXITCODE), restarting in ${RestartDelaySeconds}s..."
    Start-Sleep -Seconds $RestartDelaySeconds
}

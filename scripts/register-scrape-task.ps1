# One-off: registers the Windows Scheduled Task that runs scrape-local.ps1
# every 2 days, matching the old GitHub Actions cron ("17 19 */2 * *" UTC ~
# 05:17 Melbourne time). Run once, as your normal user (no elevation needed
# for a per-user task):
#   powershell -File scripts\register-scrape-task.ps1

$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo "scripts\scrape-local.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At 5:17AM -DaysInterval 2

# Catches up if the PC is off at 5:17am -- runs as soon as it's next on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -DontStopOnIdleEnd

Register-ScheduledTask -TaskName "imtr-scrape" -Action $action -Trigger $trigger `
    -Settings $settings -Description "Refresh imtr disruption data locally (transport.vic.gov.au blocks GH Actions/Vercel IPs)"

Write-Host "Registered. Check with: Get-ScheduledTask -TaskName imtr-scrape"

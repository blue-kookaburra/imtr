# Runs the disruption-data scrape from this machine instead of GitHub Actions.
#
# GitHub Actions' and Vercel's shared-runner IPs both now get a Cloudflare 403
# on transport.vic.gov.au (see AGENTS.md) -- a residential IP still works, so
# this replaces the "scrape" job of .github/workflows/scrape.yml, run instead
# from a local Windows Scheduled Task (see scripts/register-scrape-task.ps1).
#
# Run manually: powershell -File scripts\scrape-local.ps1

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$logFile = Join-Path $PSScriptRoot "scrape-local.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$ts] $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}

# Runs a command, appending its combined stdout+stderr to the log as plain
# UTF-8 text -- `*>>` defaults to UTF-16 and produces a garbled log.
function RunLogged($block) {
    & $block *>&1 | Out-String | Out-File -FilePath $logFile -Append -Encoding utf8
    return $LASTEXITCODE
}

Log "=== scrape run start ==="

$code = RunLogged { git pull --ff-only }
if ($code -ne 0) {
    Log "git pull failed, aborting"
    exit 1
}

$code = RunLogged { npm run scrape }
if ($code -ne 0) {
    Log "scrape failed, aborting"
    exit 1
}

$code = RunLogged { npm test }
if ($code -ne 0) {
    Log "tests failed after scrape, not committing"
    exit 1
}

git add data/disruptions.json
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Log "no changes to disruptions.json"
} else {
    RunLogged { git commit -m "Refresh disruption data" } | Out-Null
    RunLogged { git push } | Out-Null
    Log "pushed updated disruptions.json"
}

Log "=== scrape run end ==="

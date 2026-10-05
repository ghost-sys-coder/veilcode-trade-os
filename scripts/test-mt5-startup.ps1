# Read-only native Task Scheduler schema gate. Does not register or run a task.
$ErrorActionPreference = 'Stop'
$startupProjectRoot = Split-Path -Parent $PSScriptRoot
$startupPreviousPythonPath = $env:PYTHONPATH
try {
    $startupSourcePath = Join-Path $startupProjectRoot 'integrations\mt5'
    $startupTestsPath = Join-Path $startupSourcePath 'tests'
    $env:PYTHONPATH = "$startupSourcePath;$startupTestsPath"
    $startupXml = python -c "import test_cli; from trade_os_mt5.cli import load_configuration; from trade_os_mt5.startup import specification; f=test_cli.CliTests(); f.setUp(); print(specification(load_configuration(f.path))); f.tearDown()"
    if ($LASTEXITCODE -ne 0) { throw 'Startup fixture generation failed.' }
    $startupService = New-Object -ComObject 'Schedule.Service'
    $startupService.Connect()
    $startupFolder = $startupService.GetFolder('\')
    $startupValidationName = 'TradeOS-Schema-Validation-' + [guid]::NewGuid().ToString()
    # TASK_VALIDATE_ONLY=1: native schema validation, not creation/update.
    [void]$startupFolder.RegisterTask($startupValidationName, ($startupXml -join "`n"), 1, $null, $null, 3, $null)
    Write-Output 'PASS: native Task Scheduler XML validation; no task registered or run.'
} finally {
    $env:PYTHONPATH = $startupPreviousPythonPath
}

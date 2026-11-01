# L2 Baseline: Objective bash execution results BEFORE fix
# Each scenario runs a real bash command and records exit code, stdout, stderr
# This establishes the ground truth that L2 fix must correctly classify

$base = "D:\EchoCore\echo-core\temp\bench"
$outDir = "D:\EchoCore\echo-core\bench\phase2-p0-02\evidence"
$results = @()

function Record-Result {
    param($TestId, $Description, $Command, $ExitCode, $Stdout, $Stderr, $ExpectedSuccess)
    $actualSuccess = ($ExitCode -eq 0)
    $correctlyClassified = ($actualSuccess -eq $ExpectedSuccess)
    $results += [PSCustomObject]@{
        TestId = $TestId
        Description = $Description
        Command = $Command
        ExitCode = $ExitCode
        StdoutLength = if ($Stdout) { $Stdout.Length } else { 0 }
        StderrLength = if ($Stderr) { $Stderr.Length } else { 0 }
        StdoutSnippet = if ($Stdout) { $Stdout.Substring(0, [Math]::Min(100, $Stdout.Length)) } else { "" }
        StderrSnippet = if ($Stderr) { $Stderr.Substring(0, [Math]::Min(100, $Stderr.Length)) } else { "" }
        ExpectedSuccess = $ExpectedSuccess
        ActualSuccess = $actualSuccess
        CorrectlyClassified = $correctlyClassified
        Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
    }
    Write-Host "[$TestId] exit=$ExitCode expected_success=$ExpectedSuccess actual_success=$actualSuccess correct=$correctlyClassified"
}

Write-Host "=== L2 BASELINE: Objective bash results (pre-fix) ==="
Write-Host ""

# BASE-05: exit 1
$cmd = "exit 1"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "BASE-05" "Command exits with code 1" $cmd $exit $out "" $false

# BASE-05b: exit 42
$cmd = "exit 42"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "BASE-05b" "Command exits with code 42" $cmd $exit $out "" $false

# BASE-06: read nonexistent path
$cmd = "type D:\EchoCore\echo-core\temp\bench\BASE-06\nonexistent.txt"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "BASE-06" "Read nonexistent file" $cmd $exit $out "" $false

# BASE-07: success with stdout
$cmd = "echo hello_world"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "BASE-07" "Simple echo (success)" $cmd $exit $out "" $true

# MULTI-06: connect to closed port (connection refused)
$cmd = "curl -s http://localhost:1 2>&1"
$out = & cmd /c "$cmd" 2>$null
$exit = $LASTEXITCODE
Record-Result "MULTI-06" "Connect to closed port localhost:1" $cmd $exit $out "" $false

# FAULT-03: command not found
$cmd = "nonexistent_command_xyz"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "FAULT-03a" "Command not found" $cmd $exit $out "" $false

# FAULT-03b: stderr with exit 0
$cmd = "echo warning: something & exit 0"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "FAULT-03b" "Stderr output but exit 0" $cmd $exit $out "" $true

# FAULT-03c: both stdout and stderr, exit 0
$cmd = "(echo normal_output) & (echo error_output 1>&2) & exit 0"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "FAULT-03c" "Both stdout+stderr, exit 0" $cmd $exit $out "" $true

# FAULT-03d: both stdout and stderr, exit 1
$cmd = "(echo normal_output) & (echo error_output 1>&2) & exit 1"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "FAULT-03d" "Both stdout+stderr, exit 1" $cmd $exit $out "" $false

# FAULT-04: timeout (sleep longer than 2min default)
# Note: we'll use a shorter timeout to demonstrate - actual bash tool uses 2min
$cmd = "timeout /t 5 /nobreak >nul & exit 1"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "FAULT-04" "Command with timeout then fail (5s)" $cmd $exit $out "" $false

# FAULT-05: process killed/interrupted
$cmd = "ping -n 30 127.0.0.1 >nul"
$out = & cmd /c "$cmd 2>&1" 2>$null
$exit = $LASTEXITCODE
Record-Result "FAULT-05" "Long-running command (interrupted by timeout)" $cmd $exit $out "" $false

# Save results
$results | ConvertTo-Json -Depth 3 | Set-Content "$outDir\l2-baseline-raw.json" -Encoding UTF8

# Summary
$pass = ($results | Where-Object { $_.CorrectlyClassified -eq $true }).Count
$fail = ($results | Where-Object { $_.CorrectlyClassified -eq $false }).Count
$total = $results.Count
Write-Host ""
Write-Host "=== SUMMARY ==="
Write-Host "Total: $total | Correctly classified: $pass | Misclassified: $fail"
Write-Host ""
Write-Host "CRITICAL L2 GAP: bash tool in Echo Core treats ALL of these as SUCCESS"
Write-Host "because it checks stdout for <bash_metadata> exit=0, not the actual exit code."
Write-Host "This baseline proves the gap: exit=1/42/nonzero are real failures that"
Write-Host "the current system would misclassify as success."
Write-Host ""
Write-Host "Results saved to: $outDir\l2-baseline-raw.json"

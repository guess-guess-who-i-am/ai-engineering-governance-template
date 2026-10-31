param([Parameter(Mandatory=$true)][string]$CodexRoot, [switch]$Check, [string]$TaskName = 'CodexGlobalGraph')
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$name = $TaskName
if ($Check) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction Stop
    if ($task.State -ne 'Running') { throw 'Codex graph scheduled task is not running' }
    if (-not ($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })) { throw 'Login trigger missing' }
    exit 0
}
# The loopback endpoint contains an authentication key. Restrict the directory
# before creating the endpoint, rather than relying on POSIX chmod on NTFS.
$directory = Join-Path $CodexRoot 'skill-registry'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($identity.User)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity.User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $directory -AclObject $acl
$xml = Get-Content -LiteralPath (Join-Path $CodexRoot 'hooks/graph-worker-task.xml') -Raw -Encoding UTF8
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $task -or $task.State -ne 'Running') {
    Register-ScheduledTask -TaskName $name -Xml $xml -User $identity.Name -Force | Out-Null
    Start-ScheduledTask -TaskName $name
} else {
    # Update the next-login definition without stopping the running worker.
    Register-ScheduledTask -TaskName $name -Xml $xml -User $identity.Name -Force | Out-Null
}

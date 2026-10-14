$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install the current LTS release from nodejs.org, then run this script again.'
}
$securePassword = Read-Host 'Choose an APEX admin password' -AsSecureString
if ($securePassword.Length -lt 12) {
    throw 'Use an admin password with at least 12 characters.'
}
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:APEX_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    node dev-server.js
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Item Env:APEX_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}

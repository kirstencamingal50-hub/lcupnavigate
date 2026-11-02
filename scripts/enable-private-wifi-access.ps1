#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$InterfaceAlias = 'Wi-Fi'
)

$ErrorActionPreference = 'Stop'
$apache = 'C:\xampp\apache\bin\httpd.exe'
$mariaDb = 'C:\xampp\mysql\bin\mysqld.exe'

if (-not (Test-Path -LiteralPath $apache)) {
    throw "Apache was not found at $apache."
}
if (-not (Test-Path -LiteralPath $mariaDb)) {
    throw "MariaDB was not found at $mariaDb."
}

$profiles = @(Get-NetConnectionProfile -InterfaceAlias $InterfaceAlias | Where-Object IPv4Connectivity -ne 'Disconnected')
if ($profiles.Count -ne 1) {
    throw "Expected one connected IPv4 network profile for adapter '$InterfaceAlias'; found $($profiles.Count)."
}

$profile = $profiles[0]
$addresses = @(Get-NetIPAddress -InterfaceIndex $profile.InterfaceIndex -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.AddressState -eq 'Preferred' })
if (-not $addresses.Count) {
    throw "No active IPv4 address was found on '$InterfaceAlias'."
}

$privateAddress = $addresses | Where-Object {
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
} | Select-Object -First 1
if (-not $privateAddress) {
    throw "The connected adapter does not have a private IPv4 address. No firewall settings were changed."
}

if ($profile.NetworkCategory -ne 'Private') {
    Set-NetConnectionProfile -InputObject $profile -NetworkCategory Private
}

$managedRules = @(
    'LCUPNaviGatePrivateWifiHttp',
    'LCUPNaviGateBlockPublicHttp',
    'LCUPMariaDbBlockInbound'
)
foreach ($name in $managedRules) {
    Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

New-NetFirewallRule `
    -Name 'LCUPNaviGatePrivateWifiHttp' `
    -DisplayName 'LCUP NaviGATE HTTP (Private Wi-Fi)' `
    -Description 'Allow the NaviGATE site only from the local subnet on the trusted Wi-Fi adapter.' `
    -Direction Inbound -Action Allow -Enabled True -Profile Private `
    -Program $apache -Protocol TCP -LocalPort 80 `
    -RemoteAddress LocalSubnet -InterfaceAlias $InterfaceAlias | Out-Null

New-NetFirewallRule `
    -Name 'LCUPNaviGateBlockPublicHttp' `
    -DisplayName 'LCUP NaviGATE HTTP (Block Public Networks)' `
    -Description 'Prevent Apache from accepting inbound traffic on Public networks.' `
    -Direction Inbound -Action Block -Enabled True -Profile Public `
    -Program $apache -Protocol Any | Out-Null

New-NetFirewallRule `
    -Name 'LCUPMariaDbBlockInbound' `
    -DisplayName 'LCUP MariaDB (Block Inbound Connections)' `
    -Description 'Keep the campus database private; the website uses a local database connection.' `
    -Direction Inbound -Action Block -Enabled True -Profile Any `
    -Program $mariaDb -Protocol TCP -LocalPort 3306 -RemoteAddress Any | Out-Null

Write-Output "Private Wi-Fi profile configured on '$InterfaceAlias' ($($privateAddress.IPAddress))."
Write-Output 'NaviGATE HTTP is allowed only from the local subnet; Apache is blocked on Public networks.'
Write-Output 'MariaDB inbound connections are blocked. Use http://<this-PC-Wi-Fi-IP>/Capstone/ on the same Wi-Fi.'

param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{3,80}$')][string]$Username,
  [ValidateSet('admin','editor')][string]$Role = 'admin'
)
$securePassword = Read-Host 'New administrator password (12+ characters, upper/lowercase, number, symbol)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $initialPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($initialPassword.Length -lt 12 -or $initialPassword -cnotmatch '[a-z]' -or $initialPassword -cnotmatch '[A-Z]' -or $initialPassword -notmatch '[0-9]' -or $initialPassword -notmatch '[^a-zA-Z0-9]') { throw 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.' }
  $env:LCUP_ADMIN_INITIAL_PASSWORD = $initialPassword
  & 'C:\xampp\php\php.exe' 'C:\xampp\htdocs\Capstone\scripts\create-admin.php' $Username $Role
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:\LCUP_ADMIN_INITIAL_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $initialPassword = $null
}

param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Launcher.cs') -Raw -Encoding UTF8
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll','System.Windows.Forms.dll' -OutputAssembly $OutputPath -OutputType WindowsApplication

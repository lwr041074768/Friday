@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Install-OriginHelper.ps1"
if errorlevel 1 (
  echo Installation failed. Read the message above.
) else (
  echo Installation finished. Return to the website.
)
pause

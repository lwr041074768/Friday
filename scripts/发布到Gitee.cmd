@echo off
setlocal
chcp 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0Publish-Gitee.ps1" -KeepWindowOpen %*
set "SPS_PUBLISH_EXIT=%ERRORLEVEL%"
echo.
echo 本机发布脚本已结束。请以上方结果和 PUBLICATION.json 为准。
pause
exit /b %SPS_PUBLISH_EXIT%

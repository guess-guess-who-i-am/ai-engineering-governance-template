@echo off
setlocal
chcp 65001 >nul
where node.exe >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  ) else (
    echo 请先通过图形安装器安装 Node.js LTS，然后重新双击本文件。
    start "" "https://nodejs.org/en/download"
    pause
    exit /b 1
  )
)
set "CODEX_PROFILE_INTERACTIVE=1"
node.exe "%~dp0scripts\deploy-global-profile.mjs"
if errorlevel 1 (
  echo 安装未完成，请保留上方错误信息。
  pause
  exit /b 1
)
echo 全局安装和检查通过。所有工作区共享，登录Windows后常驻服务自动运行。
echo 首次Hook信任请在Codex中确认，不需要输入安装命令。
pause

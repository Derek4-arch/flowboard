@echo off
rem Flowboard: Windows launcher.
rem Finds Node.js 22.5 or newer (24 LTS recommended), starts the local server and opens your browser at
rem http://localhost:3000 (or the next free port if 3000 is already in use).
setlocal EnableExtensions
title Flowboard - kanban with AI standups
cd /d "%~dp0"

set "NODE_EXE="
rem 1. node on PATH. 2. Default installer locations, for terminals opened before Node was installed.
call :try_node "node"
if not defined NODE_EXE call :try_node "%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE call :try_node "%ProgramW6432%\nodejs\node.exe"
if not defined NODE_EXE call :try_node "%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE call :try_node "%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE goto no_node

echo.
"%NODE_EXE%" -p "'  Using Node.js ' + process.version + ' (' + process.execPath + ')'"
echo   Starting Flowboard. Your browser will open automatically
echo   (http://localhost:3000, or the next free port if 3000 is busy).
echo   Demo login: maya@example.com / flowboard123
echo   Keep this window open while you use Flowboard. Press Ctrl+C to stop the server.
echo.

"%NODE_EXE%" server\server.js --open
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" goto end
echo.
echo   Flowboard stopped with an error, exit code %EXIT_CODE%. See the messages above.
pause
goto end

:no_node
echo.
echo   Node.js 22.5 or newer was not found.
where node >nul 2>nul && (
  echo   Found an older version on PATH:
  node -v
)
echo   Install Node.js 24 LTS from https://nodejs.org and run start.bat again.
echo.
pause
exit /b 1

:try_node
rem Accept this candidate only if it runs and is version 22.5 or newer.
"%~1" -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]*100+v[1]>=2205?0:1)" >nul 2>nul
if not errorlevel 1 set "NODE_EXE=%~1"
exit /b 0

:end
endlocal

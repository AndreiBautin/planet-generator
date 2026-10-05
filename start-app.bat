@echo off
setlocal EnableDelayedExpansion
title Planet Generator - Launcher

rem ---------------------------------------------------------------
rem  Starts the Vite dev server, waits for it to answer, then opens
rem  the app in the default browser. The server runs in its own
rem  window; closing that window stops it.
rem
rem  The port is pinned: 5185 here, in vite.config.ts (strictPort) and
rem  in the README. Change all three together.
rem ---------------------------------------------------------------

set "ROOT=%~dp0"
set "PORT=5185"
set "APP_URL=http://localhost:%PORT%"

echo.
echo === Planet Generator ===
echo.

rem --- prerequisites ---------------------------------------------
where node >nul 2>&1 || (
  echo [ERROR] Node.js not found on PATH. Install Node 24: https://nodejs.org
  goto :fail
)
where pnpm >nul 2>&1 || (
  echo [ERROR] pnpm not found on PATH. Install it: https://pnpm.io/installation
  goto :fail
)

rem --- port already in use? --------------------------------------
call :is_port_open %PORT% && (
  echo [ERROR] Port %PORT% is already in use. Stop whatever is running there first.
  goto :fail
)

rem --- dependencies ----------------------------------------------
if not exist "%ROOT%node_modules" (
  echo [setup] Installing dependencies ^(first run^)...
  pushd "%ROOT%"
  call pnpm install --frozen-lockfile
  set "INSTALL_EXIT=!errorlevel!"
  popd
  if not "!INSTALL_EXIT!"=="0" (
    echo [ERROR] pnpm install failed.
    goto :fail
  )
)

rem --- launch ----------------------------------------------------
echo [start] Dev server -^> %APP_URL%
start "Planet Generator" cmd /k "cd /d "%ROOT%" && pnpm dev"

call :wait_for_port %PORT% "dev server" 60 || goto :fail

echo.
echo [ready] Opening %APP_URL%
start "" "%APP_URL%"
echo.
echo The server runs in its own window. Close that window to stop it.
echo.
ping -n 6 127.0.0.1 >nul
exit /b 0

rem ---------------------------------------------------------------
rem  :is_port_open PORT      -> exit 0 if something is listening
rem ---------------------------------------------------------------
:is_port_open
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %1 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (exit /b 1) else (exit /b 0)

rem ---------------------------------------------------------------
rem  :wait_for_port PORT LABEL TIMEOUT_SECONDS
rem ---------------------------------------------------------------
:wait_for_port
set "WP_PORT=%~1"
set "WP_LABEL=%~2"
set /a WP_LEFT=%~3
<nul set /p "=[wait] Waiting for %WP_LABEL% on port %WP_PORT% "
:wait_loop
call :is_port_open %WP_PORT% && (
  echo  ok
  exit /b 0
)
if %WP_LEFT% leq 0 (
  echo  timeout
  echo [ERROR] The %WP_LABEL% did not start. Check its window for errors.
  exit /b 1
)
<nul set /p "=."
ping -n 2 127.0.0.1 >nul
set /a WP_LEFT-=1
goto :wait_loop

:fail
echo.
pause
exit /b 1

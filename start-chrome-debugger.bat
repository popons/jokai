@echo off
setlocal enableextensions

set "PORT=%~1"
if "%PORT%"=="" set "PORT=9222"

set "START_URL=%~2"
if "%START_URL%"=="" set "START_URL=about:blank"

set "PROFILE_DIR=%~dp0tmp\chrome-debug-profile"
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%" >nul 2>&1

set "BROWSER_EXE="
for %%I in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist %%~I (
    set "BROWSER_EXE=%%~I"
    goto :found
  )
)

where /q chrome
if not errorlevel 1 (
  for /f "delims=" %%I in ('where chrome') do (
    set "BROWSER_EXE=%%~I"
    goto :found
  )
)

where /q msedge
if not errorlevel 1 (
  for /f "delims=" %%I in ('where msedge') do (
    set "BROWSER_EXE=%%~I"
    goto :found
  )
)

echo [ERROR] Chrome/Edge executable was not found.
echo [ERROR] Install Chrome or pass one via PATH.
exit /b 1

:found
echo [INFO] Browser: %BROWSER_EXE%
echo [INFO] Port: %PORT%
echo [INFO] URL: %START_URL%
echo [INFO] Profile: %PROFILE_DIR%

start "" "%BROWSER_EXE%" --remote-debugging-address=127.0.0.1 --remote-debugging-port=%PORT% --user-data-dir="%PROFILE_DIR%" --new-window "%START_URL%"
if errorlevel 1 exit /b %errorlevel%

echo [INFO] DevTools endpoint: http://127.0.0.1:%PORT%/json/version
echo [INFO] DevTools list: http://127.0.0.1:%PORT%/json/list
exit /b 0

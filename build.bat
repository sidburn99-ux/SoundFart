@echo off
REM Construit un .exe unique : dist\SoundFart.exe  (necessite Node.js)
set "ELECTRON_RUN_AS_NODE="
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge la version LTS sur https://nodejs.org puis relance ce script.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 (
  echo ERREUR : npm install a echoue.
  pause
  exit /b 1
)
call npm test
if errorlevel 1 (
  echo ERREUR : les tests unitaires ont echoue.
  pause
  exit /b 1
)
call npm run dist
if errorlevel 1 (
  echo ERREUR : le build a echoue (voir les messages ci-dessus).
  pause
  exit /b 1
)
echo.
echo Termine : dist\SoundFart.exe
pause

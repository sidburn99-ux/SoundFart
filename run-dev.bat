@echo off
REM Lance SoundFart directement (sans fabriquer le .exe) pour tester
set "ELECTRON_RUN_AS_NODE="
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge la version LTS sur https://nodejs.org puis relance ce script.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 (
  pause
  exit /b 1
)
call npm start
if errorlevel 1 (
  echo ERREUR : npm start a echoue (voir les messages ci-dessus).
  pause
  exit /b 1
)

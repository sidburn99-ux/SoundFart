@echo off
rem Lance SoundFart en environnement de test isole (%TEMP%\SoundFart-test)
rem Ta vraie config (%APPDATA%\SoundFart) n'est PAS touchee.
rem Pour repartir a zero : supprimer le dossier %TEMP%\SoundFart-test.
rem Le portable dist\SoundFart.exe est le livrable : on le prefere a un
rem eventuel win-unpacked perime.
set "ELECTRON_RUN_AS_NODE="
if exist "%~dp0dist\SoundFart.exe" (
  start "" "%~dp0dist\SoundFart.exe" --test-profile
) else if exist "%~dp0dist\win-unpacked\SoundFart.exe" (
  start "" "%~dp0dist\win-unpacked\SoundFart.exe" --test-profile
) else (
  echo dist\SoundFart.exe introuvable : lance d'abord build.bat
  pause
  exit /b 1
)

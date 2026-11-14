@echo off
rem Lance SoundFart en environnement de test isole (%TEMP%\SoundFart-test)
rem Ta vraie config (%APPDATA%\SoundFart) n'est PAS touchee.
rem Pour repartir a zero : supprimer le dossier %TEMP%\SoundFart-test.
if exist "%~dp0dist\win-unpacked\SoundFart.exe" (
  start "" "%~dp0dist\win-unpacked\SoundFart.exe" --test-profile
) else (
  start "" "%~dp0dist\SoundFart.exe" --test-profile
)

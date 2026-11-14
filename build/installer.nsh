; SoundFart - installateur deux phases (prerequis VB-CABLE)
; Phase 1 : VB-CABLE absent -> install du pilote -> cle RunOnce -> reboot -> /S
; Phase 2 : marqueur registre present -> installation silencieuse -> lancement app
; Inclusions electron-builder : ce fichier est injecte avant les includes standard,
; on utilise donc uniquement la syntaxe NSIS classique (pas de LogicLib).
; Les scripts PowerShell sont ecrits dans $PLUGINSDIR pour eviter tout probleme
; de quoting a travers nsExec/cmd.

; Ecrit les deux scripts ps1 utilises par la phase 1.
!macro SF_WritePs1
  FileOpen $R7 "$PLUGINSDIR\sf-check.ps1" w
  FileWrite $R7 "if (Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $$_.FriendlyName -match 'VB-Audio Virtual Cable' }) { exit 0 } else { exit 1 }"
  FileClose $R7
  FileOpen $R7 "$PLUGINSDIR\sf-install.ps1" w
  FileWrite $R7 "Start-Process -FilePath '$PLUGINSDIR\vbcable\VBCABLE_Setup_x64.exe' -ArgumentList '/S' -Verb RunAs -Wait"
  FileClose $R7
!macroend

; Verifie la presence du pilote VB-CABLE.
; $R8 = code de sortie powershell (0 = present, 1 = absent, autre = erreur)
!macro SF_CableCheck
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\sf-check.ps1"'
  Pop $R8
  Pop $R9
!macroend

!macro customInit
  ; Phase 2 : le marqueur ResumeInstall n'est pose que par la phase 1 ci-dessous.
  ReadRegStr $R0 HKCU "Software\SoundFart" "ResumeInstall"
  StrCmp $R0 "1" sf_go_install

  ; Phase 1 : le pilote VB-CABLE est-il deja present ?
  InitPluginsDir
  !insertmacro SF_WritePs1
  !insertmacro SF_CableCheck
  StrCmp $R8 "0" sf_go_install

  ; VB-CABLE absent -> extraction du pack + installation silencieuse (UAC, /S).
  SetOutPath $PLUGINSDIR\vbcable
  File /r "${BUILD_RESOURCES_DIR}\vbcable\*.*"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\sf-install.ps1"'
  Pop $R8
  Pop $R9

  ; Re-verification : le peripherique PnP apparait des l'install, les endpoints apres reboot.
  !insertmacro SF_CableCheck
  StrCmp $R8 "0" sf_cable_ok
  MessageBox MB_ICONSTOP|MB_SETFOREGROUND "L'installation du composant audio VB-CABLE a echoue ou a ete annulee.`n`nRelancez SoundFart Setup.exe pour reessayer."
  Quit

sf_cable_ok:
  ; Reprise automatique : copie du setup + cle RunOnce (execution unique a la session suivante)
  ; + marqueur ResumeInstall consomme par la phase 2.
  CreateDirectory "$TEMP\SoundFart"
  CopyFiles /SILENT $EXEPATH "$TEMP\SoundFart\SoundFart-Setup.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "SoundFartSetup" '"$TEMP\SoundFart\SoundFart-Setup.exe" /S'
  WriteRegStr HKCU "Software\SoundFart" "ResumeInstall" "1"
  MessageBox MB_YESNO|MB_ICONINFORMATION|MB_SETFOREGROUND "Le composant audio VB-CABLE a ete installe.`n`nUn redemarrage de Windows est necessaire pour terminer l'installation de SoundFart.`n`nRedemarrer maintenant ?`n`n(« Non » reporte la fin de l'installation a la prochaine session : elle se fera automatiquement.)" IDYES sf_reboot IDNO sf_quit
sf_reboot:
  nsExec::ExecToStack 'shutdown /r /t 60 /c "SoundFart : redemarrage pour terminer l''installation"'
  Pop $R8
  Pop $R9
sf_quit:
  Quit

sf_go_install:
!macroend

!macro customInstall
  ; Fin d'installation : si on est en phase 2 (reprise post-reboot), nettoyer les
  ; artefacts de reprise et lancer l'application (install silencieuse /S).
  ReadRegStr $R0 HKCU "Software\SoundFart" "ResumeInstall"
  StrCmp $R0 "1" sf_resume_done
  Goto sf_install_end
sf_resume_done:
  DeleteRegValue HKCU "Software\SoundFart" "ResumeInstall"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "SoundFartSetup"
  RMDir /r "$TEMP\SoundFart"
  IfSilent sf_launch_app
  Goto sf_install_end
sf_launch_app:
  Exec '"$INSTDIR\SoundFart.exe"'
sf_install_end:
!macroend

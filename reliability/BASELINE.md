# BASELINE — état au démarrage de la Reliability Factory

Date : 15 novembre 2026 (reprise de session)
Branche : hardening/v2 — HEAD 609a40c (docs campagne précédente)
main : non touchée. Remote : git@github.com:sidburn99-ux/SoundFart.git

## Environnement
- Node.js : v26.13.1
- Electron : 45.3.1 (devDependency)
- C# : .NET Framework csc.exe (Framework64 v4.0.30319) — compile OK
- OS : Windows (machine de l'utilisateur, Git Bash)
- npm audit --omit=dev : 0 vulnérabilité

## État initial mesuré
- `git status` : propre, aucun fichier préexistant modifié
- `npm test` : 23/23 verts (node:test)
- `node --check` sur 6 JS : OK
- csc AudioTap.cs : OK ; AudioEndpoint list/get : réel OK (noms corrects)
- `npm run dist` : OK -> dist\SoundFart.exe
- Commits campagne précédente : b35ae44, f334db6, a4e403a, 2266528, 609a40c

## Références
- AUDIT_FIABILISATION.md : audit initial (N1-N11, R1-R14, M1-M11, S1-S6)
- STABILITY_STATUS.md : validations manuelles utilisateur 15/11/2026
- Validations manuelles à rejouer après toute modif audio : checklist §18 mission

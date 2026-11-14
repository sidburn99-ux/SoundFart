---
name: release
description: Procédure de livraison SoundFart — vérifications, build, suivi, commit, push, rapport. À invoquer pour finaliser un changement ou préparer une release.
allowed-tools:
  - exec
  - read
  - grep
  - edit
  - write
---

Exécuter la Definition of Done de `AGENTS.md` dans l'ordre :

1. `git status` + `git diff` : vérifier le périmètre (pas de fichiers étrangers, pas de secrets).
2. `node --check` sur chaque fichier JS modifié.
3. `npm test` — tous les tests doivent passer ; ne jamais supprimer un test pour verdir.
4. Si changement fonctionnel : `npm run dist` (vérifier qu'aucun `SoundFart.exe` ne tourne avant — verrou fichier).
5. `suivi.tsv` à jour (statuts honnêtes : écrit / compilé / testé auto / testé réel / validé terrain) puis `powershell regen-suivi.ps1` pour régénérer `suivi.html` — jamais éditer le HTML à la main.
6. Docs impactées (`SPECIFICATION.md`, `GUIDE.md`, `README.md`) si le comportement a changé.
7. Commit en français axé « pourquoi » + trailer Devin, puis `git push` sur la branche de travail (jamais sur `main` sans autorisation).
8. Rapport final : fichiers modifiés, commandes exécutées et résultats exacts, ce qui est testé réel vs NON testé, commits.

Rappels audio : un fichier créé ne prouve pas du son — mesurer un niveau non nul. Distinguer explicitement tests simulés et tests réels Windows/VB-CABLE/Discord.

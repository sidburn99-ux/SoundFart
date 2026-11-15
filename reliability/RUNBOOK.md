# RUNBOOK — reprise de session

1. `git checkout hardening/v2 && git status` — vérifier arbre propre.
2. Lire reliability/NEXT_ACTIONS.md puis CAMPAIGN_LOG.md (dernière entrée).
3. `npm test` + `node --check` sur fichiers modifiés depuis.
4. Reprendre la première anomalie NEW/INVESTIGATING par gravité dans FINDINGS.md.
5. Règles : commits par correction cohérente, push hardening/v2, jamais main.

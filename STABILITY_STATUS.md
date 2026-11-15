# STABILITY_STATUS.md — État de stabilité de SoundFart

> Document de référence pour l'état des validations. Mise à jour à chaque
> campagne de test ou correctif majeur. Les validations **manuelles** (réelles,
> sur la machine de l'utilisateur) et **automatisées** sont distinguées —
> jamais confondues.

## Validation manuelle du 15 novembre 2026

- **Commit** : `8f756f7` (« P0 : repare la detection des peripheriques audio »)
- **Branche** : `hardening/v2` (non fusionnée dans `main`)
- **Environnement** : machine Windows réelle de l'utilisateur, `dist\SoundFart.exe` portable
- **Nature** : tests **manuels** effectués par l'utilisateur — PAS des tests automatisés, PAS exécutés par Devin.

### Régression corrigée (contexte)

Le commit `8f756f7` répare une régression bloquante : `enumerateDevices()` ne
retournait que deux entrées génériques vides (`deviceId`/`label` vides) et
`permissions.query('microphone')` répondait `denied`. Cause : Electron 45 /
Chromium récent exige la permission `'microphone'` (distincte de `'media'`)
pour `getUserMedia({audio})` et l'exposition des labels/deviceId ; les handlers
précédents ne connaissaient que `'media'`/`'display-capture'` et refusaient
aussi `'media'` quand `details.mediaTypes` était absent.

### Résultats validés manuellement (15/11/2026)

| # | Validation | Statut |
|---|---|---|
| 1 | Détection des périphériques : listes de sortie et d'entrée réaffichées, périphériques réels détectés | ✅ Manuel |
| 2 | Sortie audio : le son de SoundFart sort dans le casque de l'utilisateur | ✅ Manuel |
| 3 | Routage Discord : les autres utilisateurs entendent les sons diffusés | ✅ Manuel |
| 4 | Enregistrement : voix Discord + microphone personnel enregistrés | ✅ Manuel |
| 5 | Persistance : tout re-validé après fermeture/redémarrage de l'application | ✅ Manuel |

### Validation automatique associée au commit (par Devin)

- `node --check` sur les JS modifiés : OK
- `npm test` : 23/23 (dont 8 nouveaux tests `media-permission`)
- `npm run dist` : `dist\SoundFart.exe` régénéré
- Run réel de l'exe (smoke, ~15 s) : permissions `media`/`audio` → `ALLOW` dans
  `soundfart.log` ; `config.json` persisté avec labels/deviceId réels
  (CABLE Input, Realtek, CABLE Output). Ce smoke test ne couvre PAS les 5
  validations fonctionnelles ci-dessus.

### Points restant à vérifier

- Reconnexion WASAPI à chaud (`AUDCLNT_E_DEVICE_INVALIDATED`) : implémentée,
  **jamais testée sur matériel réel** (débranchement USB, `net stop audiosrv`).
- Crash renderer `AudioContext` (exitCode -1/143) : cause racine **non
  démontrée** ; télémétrie heap/PCM en place, aucune occurrence depuis.
- Formats audio 24 bits : rejetés proprement, pas de fallback.
- Endurance longue session (fuite mémoire/CPU) : non mesurée.
- `npm audit` : 6 vulnérabilités modérées dans la chaîne electron-builder
  (dev-only, non corrigées).
- Tests de charge, multi-enregistrements simultanés, import massif : non couverts.

## Campagne de fiabilisation du 15 novembre 2026 (suite)

Commits sur `hardening/v2` après l'audit (`f539705`) :

| Commit | Contenu | Statut |
|---|---|---|
| `b35ae44` | C# : PROPVARIANT ABI (24 o via IntPtr), `Start()` WASAPI vérifié, restauration stricte par rôle + rôle `multi`, fuite GetMixFormat, `SameAs`+isFloat, cbSize extensible, PCM 24 bits, anti-repliement décimation, GetId loggé, S_ sleep, ReleaseBuffer hr, TryParse invariant, UTF8 | Compilé + `AudioEndpoint list/get` **testé réel** (tous périphériques nommés) ; AudioTap non rejoué en flux réel — **NON testé matériel** |
| `f334db6` | Renderer : cacheDelete (bufCacheBytes), modal() promesses sur Echap, editSound+confirmBox, previewBtn, offProg, tapStop repli, catch promesses, getBuffer robuste, cablePresent dégradé, actx.resume, rec.onerror honnête, normalizeCfg types, retry 'interrupted', transfer PCM, alignement worklet | `node --check` + 23/23 tests ; UI non rejouée — **NON testé réel** |
| `a4e403a` | main.js : yt:download single-flight, autoSetupChain, execFileTracked partout, uncaughtException→quit, shortcuts null, yt:info JSON, displayMedia origine, dialog 2ᵉ crash, .bak objet | `node --check` + tests ; **NON testé réel** |
| `2266528` | Scripts : test-env/build/run-dev/regen-suivi, test tautologique, SPECIFICATION WASAPI | regen vérifié, tests verts |

### Points restant à vérifier (inchangés + nouveaux)

- Toute la chaîne audio réelle (reconnexion USB, audiosrv, Discord pair,
  enregistrement complet) : **à revalider manuellement** — les 5 validations
  du 15/11 datent d'avant cette campagne.
- PROPVARIANT : `list`/`get` vérifiés ; `set`/`restore`/`guard` non rejoués
  (destructive sur config audio — à tester via l'app).
- Anti-repliement et PCM 24 bits : compilés, non audités à l'oreille.
- `uncaughtException`→quit : nouveau comportement, jamais déclenché en test.

## Historique des régressions audio

| Date | Commit | Problème | Résolution |
|---|---|---|---|
| ~15/11/2026 | `8f756f7` | `enumerateDevices` vide, permission `microphone` refusée (Electron 45) | Permission `microphone` accordée, `media` audio-seul, journalisation `[perm]`, protection `devicesDegraded` |
| Avant | — | Modales `askDestDir`/`recordedSound`/`yt:download` détruites (slot unique) | Modale de résultat dédiée |
| Avant | — | Voix zombies sur AudioContext suspendu | Watchdog par voix |
| Avant | — | Orphelins yt-dlp/ffmpeg au quit | `childProcs` + `killTree` |
| Avant | — | TOCTOU garde micro (`RestoreFromFile`) | `expectedOwner` revérifié sur la même lecture |

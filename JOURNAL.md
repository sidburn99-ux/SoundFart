# Journal — SoundFart

> **Journal narratif unique** : historique des versions, campagnes et validations.
> - Journal technique par commit : `suivi.tsv` (+ `suivi.html` régénéré via `regen-suivi.ps1`)
> - Registre des anomalies de la campagne de fiabilisation : `reliability/FINDINGS.md`
> - Checklists de validation matérielle : `VALIDATION.md`, `TESTS_VM.md`
>
> Règle : ne jamais marquer une fonctionnalité « testée » sans l'avoir réellement testée.

## État actuel : v1.4 + branche `hardening/v2`

### Changements récents sur `hardening/v2` (15-16/11/2026)

- **Campagne de fiabilisation** (audit → corrections → Quality Gate V2) : voir section dédiée ci-dessous.
- **Normalisation loudness LUFS** : remplace la normalisation par pic. Mesure BS.1770 **100 % JS** (`SFUtils.loudnessFromPcm`, coefficients exacts validés ~0,05 LU vs ffmpeg ebur128), cible `normLufs` (-18 LUFS défaut, -40 à 0), plafond de pic -1 dBFS, maxGain ×4. Bouton « Tester » (bruit rose calé sur la cible, écoute locale). Fichiers < 400 ms : une seule zone d'énergie. **Aucune dépendance externe** — l'app reste portable.
- **Réglages audio en 4 onglets** (Périphériques / Niveaux audio / Stockage / Général) + bouton reset « volume 100 % / norm ×1 » pour tous les sons (confirmation 2 clics).
- **Migration config v1→v2** : les anciens `s.norm` (basés pic) sont invalidés à ×1 ; volumes manuels, découpes, favoris, catégories, raccourcis préservés.
- Correctifs : cible de normalisation persistée dès la saisie, progression de normalisation en ligne dans le panneau (qui reste ouvert), scan de pic exhaustif, **crash fatal corrigé dans `downloadFile`** (`res()` appelait la réponse HTTP au lieu de `resolve` — touchait tous les téléchargements d'outils).

## Campagne de fiabilisation (15/11/2026)

Audit complet (3 revues parallèles + recherche documentaire) puis corrections par cycles, avec Quality Gate V2 (CLOSED exige cause + test + non-régression + revue indépendante + runtime + limites documentées).

**Chiffres vérifiés dans `reliability/FINDINGS.md` le 16/11/2026** (les anciens docs annonçaient 166 ou 168 anomalies — périmés) :

| Statut | Nombre |
|---|---|
| Anomalies uniques recensées | **178** |
| CLOSED | **148** |
| ACCEPTED (risques assumés documentés) | **27** |
| FIXED_PENDING_VALIDATION | **2** (SF-REL-0607 throttle ui:log, SF-REL-0609 cap touche raccourci) |
| INVESTIGATING | **1** (SF-REL-0611 crash renderer AudioContext exitCode -1/143 — cause : mort du process audio utility Chromium ; mitigation en place, surveillance passive, jamais masqué) |

Corrections majeures : permissions `microphone` Electron 45 (écran vide/P0), PROPVARIANT ABI C#, `downloadFile` sans deadline + crash `res()`, yt-dlp single-flight, orchestrateur ffmpeg (zip via tar System32), restauration micro blindée (guard pid + watchdog), validation IPC `senderFrame`, config `.bak`/`.broken`, 51+ tests `node:test`.

**Restes connus** : validations matérielles en attente (voir `VALIDATION.md`), 27 ACCEPTED = compromis documentés (doublons de findings signalés dans FINDINGS §dédoublonnage), `npm audit` : 6 vulnérabilités modérées dans electron-builder (outil de build, non embarqué).

## Validations

- **Manuelle 15/11/2026** (machine réelle, `dist\SoundFart.exe`) : détection périphériques, sortie casque, routage Discord, enregistrement micro+Discord, persistance après redémarrage — **5/5 OK**.
- **Automatisées** : `node --check`, `npm test` (51/51 au 16/11), `npm run dist`, smokes `--test-profile`, validations runtime agent (imports massifs, enregistreur multi-sources avec mesure RMS, rejouements ×10, kill brutal sans orphelins).
- **NON testé / à faire** : écoutes comparatives LUFS à l'oreille, normalisation complète sur la bibliothèque réelle, flux VB-CABLE complet sur machine propre (`TESTS_VM.md`), endurance longue session, débranchement chaud des périphériques.

## Historique des versions

### v1.4 — portable only, VB-CABLE manuel, robustesse audio, tests
- [x] Portable uniquement (`SoundFart.exe`, compression store ~375 Mo, démarrage ~2 s) + `SoundFart-data/` à côté de l'exe (config/outils/logs)
- [x] VB-CABLE jamais embarqué (licence) : écran d'accueil + bandeau + lien officiel + détection à chaud `devicechange`
- [x] Instance unique stricte ; AudioTap PCM float32→IPC→AudioWorklet (anti-écho Discord) ; gardes parent/erreurs/downmix ; guard `<pid>` + watchdog async + bouton « Restaurer mon micro »
- [x] Téléchargements vérifiés SHA-256 + versions épinglées ; outils C# hashés ; cache 256 Mo ; IPC validé ; CSP durcie ; `lib/audio-utils.js` + tests `node:test` ; logs à niveaux + session
- NON testé : flux complet avec VB-CABLE installé, appel Discord réel

### v1.3 — coupe physique MP3, dossier de stockage, vignettes, bascule micro auto
- ffmpeg téléchargé auto (~80-115 Mo) : extraits YouTube en vrai MP3 + « MP3 de l'extrait » dans l'éditeur
- Dossier de stockage configurable (`imports/`, `recordings/`, `cuts/`)
- Vignettes emoji+dégradé par carte ; bascule auto de l'entrée micro Windows sur CABLE Output + restauration (`AudioEndpoint.exe` C#, testé bascule+restauration)
- v1.3.1 : enregistreur multi-sources (micro + audio PC loopback + câble)
- v1.3.2 : permission `display-capture`, version visible, echo cancellation micro
- v1.3.3 : regroupement par catégorie + menu F11
- v1.3.4 : « Audio du PC » via `AudioTap.exe` (loopback WASAPI → PCM → CABLE Input, contourne le bug Electron/Windows de capture bureau)
- v1.3.5 : VB-CABLE bundlé + install silencieuse — **annulé en v1.4** (licence : jamais embarqué)
- v1.3.6 : 5 sons par défaut + restauration micro généralisée (rôle `multi`)

### v1.2 — favoris, raccourcis globaux, enregistreur, YouTube, normalisation, sauvegarde
- Favoris (★), tête de lecture temps réel, retrouver fichier manquant
- Raccourcis clavier globaux par son + STOP global (`globalShortcut`)
- Normalisation du volume (par son + bibliothèque ; aujourd'hui en LUFS — voir ci-dessus)
- Enregistreur intégré (micro/périph., webm/opus), import YouTube (yt-dlp auto), export/import config JSON
- Formats : webm, mp4, mkv, mov, m4v

### v1.1 — tri des catégories + éditeur de découpe
- Tri perso/A-Z/Z-A, éditeur avec onde + repères début/fin + fondus — découpe non destructive

### v1.0.1 — écran noir + sécurité
- Correctif structure `src/`, journal d'erreurs, F12, Electron 45 + electron-builder 26 (0 alerte embarquée)

### v1.0 — réécriture Electron
- Thème sombre, catégories, volume par son (0-300 %, limiteur), tri, trim, migration config Python, `build.bat` → `dist\SoundFart.exe` portable

### Historique Python/Tkinter (dossier DiscordSoundboard)
- v0.1 premier jet → v0.4 renommer les sons

## À faire / idées

- [ ] Tester sous Windows réel : tout le flux audio (voir `VALIDATION.md`, `TESTS_VM.md`)
- [ ] Écoute comparative de la normalisation LUFS sur la bibliothèque réelle
- [ ] Son aléatoire / plusieurs sons sur un même raccourci, boucle, mode « maintenir pour jouer »
- [ ] Lancement auto Windows, réduction dans la barre des tâches (portée portable — non fait volontairement)

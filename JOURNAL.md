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
- **Paramètres style Discord** : panneau élargi (980 px) avec navigation latérale groupée (Audio / Bibliothèque / Général) — sections Sortie audio, Micro & voix, Bibliothèque, Données & stockage, Général, chacune avec description. Remplace les anciens onglets.
- **Migration config v1→v2** : les anciens `s.norm` (basés pic) sont invalidés à ×1 ; volumes manuels, découpes, favoris, catégories, raccourcis préservés.
- Correctifs : cible de normalisation persistée dès la saisie, progression de normalisation en ligne dans le panneau (qui reste ouvert), scan de pic exhaustif, **crash fatal corrigé dans `downloadFile`** (`res()` appelait la réponse HTTP au lieu de `resolve` — touchait tous les téléchargements d'outils).

## Feature dossier de sons + audits autonomes (17/11/2026, branche `feat/dossier-sons-first-run`)

Stockage migré vers `%APPDATA%\SoundFart` (réglages/outils/logs) + dossier de sons choisi par l'utilisateur (fichiers créés : `sons/`, `imports/`, `recordings/`, `cuts/`). PR #7 ouverte, **non mergée** — validation terrain en attente (section H de `VALIDATION.md`).

### Fonctionnalités

- **Migration unique** `SoundFart-data` → AppData : config reprise (chemins JSON réécrits, échappés + bruts + `/`), tools/imports/recordings/cuts/default-sounds copiés, backups `.pre-migration-*`, marqueur `.migrated-from-portable`. Vérifiée en réel sur le profil utilisateur (36 sons, réglages conservés).
- **Bannière « dossier de sons »** : skippable, obligatoire dès qu'une action crée un fichier (`ensureStorageDir`).
- **`files:import`** : copie atomique (`.part` unique pid+seq) dans `<dossier>/sons/`, dédoublonnage nom+taille+échantillons tête/queue 4 Kio — réimport = réutilisation, jamais de doublon. Retrait d'un son conserve le fichier.
- YouTube/éditeur/enregistreur routés vers le dossier choisi ; `storageDir`/`lastDestDir` prioritaires.

### Audits (boucle continue, ~40 commits — détail dans `suivi.tsv`)

Tous les modules couverts : `main.js`, `media-tools.js`, `app.js` (intégral), `settings.js`, `recorder.js`, `youtube.js`, `edit-sound.js`, `normalize.js`, worklets `voice-gate.js`/`tap-processor.js`, `AudioEndpoint.cs`/`AudioTap.cs`, preload/IPC (parité vérifiée), drivers CDP, scripts build.

- **Réglages** : champ LUFS vide → `normLufs=0` (normalisation à fond — P2), `maxDurIn` vide → illimité silencieux, `storageDir` non persisté, `voiceLvl` sans effet, import config (bannière, annulation, catches).
- **Moteur `[AUDIO]`** : plafond 32 voix revérifié post-décode, timeout `decodeAudioData` 30 s (sémaphore fuyable → lectures muettes), `stopFallback` déconnectait pas les nodes, `bufInflight` garde d'identité, cache aperçus, voice-gate gain stéréo synchronisé + hygiène NaN/denormal.
- **Cycle de vie** : `file:check` → `{missing, sigs size:mtime}` (fichier réécrit à chemin constant = cache invalidé), devicechange un seul rebuild, catches `init`/`importConfig`/`openSettings`, reload renderer fenêtré 5 min, watchdog `quitting`, dialogs sur fenêtre détruite, `rec:save` byteLength UTF-8.
- **Tests** : `test/normalize-cfg.test.js` — fuzz adversarial de `normalizeCfg` (9 tests, npm test 57→66).

### Reste ouvert

- **SF-REL-0611** (crash renderer `-1/143`) : non reproduit en conditions contrôlées ; instrumentation en place, protocole forensique dans `VALIDATION.md`.
- Validations matérielles : ~25 cases dans `VALIDATION.md` (sections H/I prioritaires : feature dossiers, voix stéréo `[AUDIO]`).
- Micro perdu → rebuild complet stoppe les sons en cours (voulu, documenté GUIDE).

## Campagne audit auto (16/11/2026, branche `audit/auto-improve`)

Boucle audit → correction → vérification, ~13 commits unitaires. Baseline : `npm test` 54/54, `node --check` OK sur 20 fichiers JS.

### Corrigé (vérifié : node --check + npm test + npm run dist)

- **Bug critique post-découpage** : `main/media-tools.js` utilisait `AUDIO_EXT`/`safeName`/`cbOrNoop` non injectés → `ReferenceError` sur `media:cut`, `downloadFile`, `runYt` (invisible à `node --check`/`npm test`). Corrigé via `require('../lib/audio-utils')`.
- Cycle de vie process : `childProcs` retiré aussi sur `'exit'` (fenêtre de réutilisation de PID), `execFileTracked` timeout avec `p.kill()` fallback, `whenReady().then` avec `.catch` (zombie sans fenêtre sinon), `nameOf` filtré `flow='capture'`.
- Téléchargements/outils : `httpsGetText` HTTPS-only + ≤5 redirections, `ffmpegDir()` fichier → `readdirSync` ENOTDIR permanent corrigé, `out.destroy()` sur dépassement 300 Mo, `runYt` stdin ignoré, tri `mtime`/`statSync` gardés (fichier disparu = plus de crash ENOENT), `yt-dlp.json` écriture atomique, ménage des `.part`/`.ytdl` orphelins dans `imports/`.
- `spawnMicGuard` sans listener `'error'` → `uncaughtException` possible.
- Renderer : race AudioTap inter-sessions (garde par génération — un vieux cleanup ne tue plus le tap d'une nouvelle session), YouTube `analyzeBusy`/`downloadBusy` séparés + `analyzedUrl` lie l'info au lien, `importConfig` → `syncTopbarControls()` + `audioAutoSetup` rejoué, `catSort`/`moveCategory` → `renderAll()` (grille périmée), checkbox « Par catégorie » sync menu F11, `askDestDir` refuse les chemins relatifs, `modal()` `onClose` protégé (promesse plus pendue), `nowplaying` affiche les aperçus, `seedSounds` non-tableau sécurisé, fondus bornés 5000 ms, `resetArmTimer` annulé à la fermeture, réponses IPC `ytDownload`/`mediaCut`/`saveRecording` validées, `file:read` message dossier dédié, `soundHasCat` O(1) via Set caché, `VIRTUAL_RE` sourcé depuis `SFUtils`.
- Docs : GUIDE LUFS -30→-40, JOURNAL 51→54, SPEC +`lib/`+`main/`, README +SPEC/+FINDINGS.

### « À valider » (non appliqué — risque de régression ou invérifiable ici)

- **`setDisplayMediaRequestHandler`** : callback sans source vidéo pour une requête `video+audio` — le repli `getDisplayMedia` de l'enregistreur est probablement mort. Fix proposé : fournir `sources[0]` en vidéo ou documenter le repli comme mort. Vérifier par test réel avec « audio du PC » + tap en échec.
- **`normalizeCfg`** : valider chemins absolus + extension `AUDIO_EXT` à l'import — risque d'écarter des sons existants d'anciennes configs.
- **`audioExecSync`/`restoreMicNow`** : restauration synchrone ~45 s max dans `will-quit` ; dédup `restoreMicNowP`/`restoreMicNow` (~35 l.) — zone micro sensible, à faire en chantier dédié avec test VB-CABLE.
- **`test/cdp-*.js`** : 14 drivers CDP dans `test/` — risque si `node --test` élargit son glob (Node ≥21/22 exécute tout `.js` sous `test/`). Déplacement vers `scripts/cdp/` proposé mais **AGENTS.md (intouchable) documente `test/` comme contenant les drivers** — à valider avec mise à jour d'AGENTS.
- **`AudioEndpoint.cs`/`AudioTap.cs`** : déplacement éventuel vers `tools-cs/` — exige maj `build.bat` + toutes les références `__dirname` ; non vérifiable sans compile/runtime complet.
- **`.gitignore` `.mp3`** : règle large qui empêcherait de committer un futur son par défaut — intention ambiguë, laissé tel quel.
- **`enabled: !!opts.enabled`** dans `audio:autoSetup`/`audio:restore` : accepte `'false'` string comme actif — contrat IPC interne seulement, low impact.
- **Fusion docs** : `README`/`GUIDE`/`SPECIFICATION`/`VALIDATION`/`TESTS_VM` ont des rôles distincts (présentation / utilisateur / technique / plans de test) — pas de fusion, aucun recouvrement significatif après corrections.
- **`main/` vs `main.js`** : pas redondant — `main/` est un sous-dossier de modules CommonJS (`require('./main/media-tools')`), `main.js` est le point d'entrée.

### Non vérifié dans cet environnement

- UI interactive complète, IPC `yt:*`/`media:cut` réels, enregistreur multi-sources, routage audio — « À valider » terrain.
- Smoke post-build : exe lancé, AudioContext créés, aucune erreur `[page]` dans `soundfart.log`.

## Deuxième passe ciblée (16/11/2026, branche `audit/pass-2`)

Baseline : `npm test` → pass 54 / fail 0 ; `node --check` OK sur les 19 fichiers JS ; `npm run dist` OK ; smoke : `env -u ELECTRON_RUN_AS_NODE ./dist/SoundFart.exe` → AudioContext créés (`makeOutput: creation AudioContext device=default`), aucune erreur `[page]` dans `soundfart.log`.

Vérifiable ici : `node --check`, `npm test`, `npm run dist`, build `.bat`/`.ps1`, smoke exe, instanciation de `createMediaTools` avec deps stub. **Non vérifiable** : UI interactive, audio réel, Discord, VB-CABLE, téléchargements YouTube/ffmpeg réels (pas de réseau utilisé), compilation C# à l'usage.

### Contre-vérification de la passe 1

- **`media-tools.js` — vrai défaut trouvé et corrigé** : `killTree()` appelé au timeout yt-dlp (2 min) sans être injecté → `ReferenceError` (même famille que le bug `AUDIO_EXT`). Injecté via deps (`main.js` + destructuration). Après fix : scan de tous les symboles top-level de `main.js` contre le module → aucun autre symbole non injecté ; instanciation réelle OK, 4 handlers IPC enregistrés (`media:cut`, `yt:ensure`, `yt:info`, `yt:download`).
- **`childProcs`** : `'close'`/`'error'`/`'exit'` retirent tous du Set (`Set.delete` idempotent, pas de double-kill) ; `will-quit` itère une copie puis `clear()` ; `killTree`/`p.kill()` sur un process déjà mort = no-op silencieux. Restore micro à la fermeture : `will-quit` → `restoreMicNow` (budgeté, voir ci-dessous) + garde externe `audio-restore.json` pour les morts sans will-quit. OK.
- **Ménage `.part`/`.ytdl`/`.temp`** : ne touche que `imports/` et uniquement les fichiers préfixés `sf-<tag>-` où `<tag>` = `Date.now().toString(36)` + aléatoire régénéré par requête yt-dlp — collision avec un fichier utilisateur pratiquement impossible, et `imports/` est un dossier géré par l'app. OK.

### Corrigé

- **`killTree` non injecté** dans `createMediaTools` (cf. ci-dessus) — commit `7ef3187`.
- **`audioExecSync`/`restoreMicNow` borné** : 3 `execFileSync` × 15 s = ~45 s de gel possible du `will-quit` si `AudioEndpoint.exe` se fige (COM). Budget global 8 s partagé entre les appels, timeout par appel `min(5000, restant)` ; en cas de dépassement le marqueur `audio-restore.json` est conservé → reprise au prochain lancement (`restoreMicNowP`) ou par la garde externe. Preuve : 3 appels sur processus dormant 30 s → abort à 8,0 s (`ETIMEDOUT` à 5,0 s puis `budget epuise`), au lieu de ~45 s.
- **`normalizeCfg` : validation des chemins** : nouveau `SFUtils.isUsablePath` (`lib/audio-utils.js`) — string non vide, sans caractère de contrôle, chemin absolu aligné sur `path.win32.isAbsolute` (lettre, `UNC`, `/`, `\`). Appliqué à `s.path` (purge + `uiLog`), `settings.storageDir`, `settings.lastDestDir` (qui gagnent aussi le rejet des caractères de contrôle). Rétrocompat vérifiée par tests : `\\NAS\`, `\\?\`, `Z:\`, accents, espaces, apostrophes acceptés ; relatifs, vides, `file://`, non-strings rejetés. `npm test` 56/56.

### « À valider » — mise à jour

- **Résolus par cette passe** : `normalizeCfg` chemins, `audioExecSync` blocage `will-quit`.
- **`normalizeCfg` — limite volontaire** : la validation porte sur la *forme* du chemin (absolu, sain), pas sur l'existence ni l'extension audio — un chemin absolu vers un `.txt` ou un fichier disparu reste en config (badge « manquant » + relocation, comportement existant conservé).
- **Toujours « À valider »** (inchangés) : `setDisplayMediaRequestHandler`, dédup `restoreMicNowP`/`restoreMicNow`, déplacement `test/cdp-*.js`, déplacement `AudioEndpoint.cs`/`AudioTap.cs`, `.gitignore` `.mp3`, `enabled` permissif.

### Non vérifié dans cet environnement (passe 2)

- `media:cut`/`yt:download` exécutés pour de vrai (nécessitent ffmpeg/yt-dlp — pas de téléchargement réseau lancé) : vérifiés par instanciation du module + lecture, pas par exécution.
- Restauration micro réelle sur matériel (AudioEndpoint.exe compilé à l'usage) : le budget 8 s est prouvé sur `execFileSync` générique, pas sur le vrai binaire.
- Comportement `normalizeCfg` dans l'UI réelle (purge de sons à chemin invalide) : logique testée unitairement via `isUsablePath`, pas rejouée en interface.

## Campagne audits autonomes ×10 (16/11/2026, branche `fix/audio-robustness`)

10 itérations : 3 audits parallèles par sous-agents (domaines renderer, recorder/AudioTap, lib/preload/media-tools) + revue directe `main.js`, `app.js` core, scripts, `package.json`. ~20 constats réels corrigés en 7 commits unitaires.

### Corrigé (vérifié : node --check + npm test 57/57 + npm run dist + smoke --test-profile propre)

- ~~**Micro bypassait le gain master**~~ **ANNULÉ par décision produit** : la voix est reconnectée directement sur `lim` (amont de `bus`) — le réglage master reste celui de la soundboard, la voix garde son propre réglage (Windows/Discord). Limiteur conservé en aval pour la protection crête. `npm test` 57/57 + `npm run dist` OK.
- **`normalizeAll(host)` invisible** : le panneau réglages fermé ne stoppait pas la boucle (computeNorm sur toute la bibliothèque en arrière-plan) → test `host.isConnected`.
- **Éditeur** : `pointercancel` non géré (drag fantôme déplaçait le marqueur), `timeAt` NaN si `r.width=0`, `catch loadWave` loggé.
- **Enregistreur** : `closedDuringRec` posé seulement si `rec.state!=='inactive'` → un `onstop` en vol ouvrait sa modale et détruisait une autre modale ; `actx` suspendu → toast (fichier silencieux sinon invisible) ; catches `audioTapStop`/`rec.stop` loggés.
- **YouTube** : `e.message` undefined possible → fallback ; nom de pré-écoute non trimé.
- **`normalize.js`** : `ctx.resume().catch({})` → logErr.
- **`media-tools.js`** : `downloadFile` laissait des fichiers partiels → unlink avant reject ; `httpsGetText` sans deadline totale (slow-drip bloquait `ytdlpPromise` à jamais) → 60 s ; `findFile` readdirSync non protégé ; template yt-dlp non échappé (`%` dans storageRoot cassait tout import) ; ménage `imports/` étendu aux audio complets des tags avortés ; timeout `runYt` marqué `timedOut` → le retry ne force plus une maj yt-dlp ~100 Mo pour un contenu trop long (timeout 2 min conservé, règle projet).
- **Audits propres, rien à corriger** : `main.js` (watchdog, IPC, menu, AudioTap, will-quit), `lib/audio-utils.js` (math BS.1770 vérifiée ligne à ligne par le subagent), `lib/media-permission.js`, `preload.js` (parité complète 23 invoke + 3 send + 7 on), `package.json`, `.bat`/`.ps1`, `tap-processor.js`.

### « À valider » / non vérifié (campagne)

- **`runYt` timedOut** : le retry sur timeout ne se fait plus que si la maj n'est pas à jour — comportement voulu, à observer sur un import long.
- **Ménage audio orphelin** : suppression de fichiers `sf-<vieux-tag>-*.mp3` — vérifié statiquement (tags uniques par requête, `newest` protégé), pas en réel.
- Race `normBtn` vs « Enregistrer » dans l'éditeur (gain perdu si enregistrement pendant computeNorm) — laissée, demande un choix produit (désactiver Enregistrer pendant le calcul).
- `dl = null` symétrique dans youtube.js — chemin quasi-mort, non appliqué (cosmétique).

## Campagne terrain + correctifs (16/11/2026, branche `fix/audio-robustness`)

QCM de validation utilisateur (~50 points) : quasi tout OK. Bugs rapportés et traités :

### Corrigé

- **Micro USB rebranché ne revenait pas + larsen après reconnexion** : `devicechange` ne rebuildait que si un deviceId changeait — or l'ID Windows est stable au rebranchement → voix morte. Et si `applyAudio` tournait micro absent, `getUserMedia` sans contrainte prenait le périphérique par défaut = CABLE Output (post-bascule) → capture de la sortie Discord = larsen. Fix : rebuild si micro requis mais stream mort ; plus jamais de repli implicite (micro non résolu = warn).
- **Veille/réveil → app morte** : Chromium ferme les `AudioContext` (`closed`) au réveil ; le handler ne rebuildait que sur `interrupted`. Rebuild borné (5 essais, 2,5 s) si le contexte est encore référencé ; les fermetures volontaires (teardown) ne rebuildent pas.
- **« Tout réinitialiser » (éditeur)** ne remettait que trim/fades → étendu à volume + normalisation ; nom/catégorie/favori/raccourci conservés.
- **Restauration micro à la fermeture** : pas de bug trouvé à la lecture — logs ajoutés (`[mic] will-quit` marqueur + résultat OK/échec) pour trancher au prochain test utilisateur.
- **YouTube** : bouton « Annuler le téléchargement » (`yt:cancel` tue l'arbre yt-dlp) ; erreurs traduites en français (`ytErrFr` : privée, indisponible, 429, 403, timeout, réseau).
- **Raccourci « touche simple »** : comportement voulu (un raccourci global Windows exige modifieur ou F — sinon il volerait la frappe). Hint déjà présent, pas de bug.

### Features ajoutées (validées par l'utilisateur)

- **Voice gate** : `src/voice-gate.js` AudioWorklet (highpass ~80 Hz + downward expander −50 dBFS) sur la voix uniquement + contraintes EC/NS/AGC getUserMedia déjà actives. Réglage `voiceDsp` (défaut actif) dans Réglages → Micro.
- **Limite de durée par son** : `maxSoundDur` (défaut 45 s, 0 = illimité) — borne la lecture à `[trimStart, +max]`, fichier jamais coupé, toast une fois par fichier, avertissement à l'analyse YouTube. Réglable dans Réglages → Niveaux audio.
- **Enregistreur** : jauge de niveau temps réel (AnalyserNode sur le mix) + bouton « Écouter » dans la modale de résultat avant ajout.
- **Imports orphelins** : IPC `imports:list` + entrée « Parcourir les fichiers non ajoutés… » (Paramètres → Bibliothèque) — les fichiers de `imports/` absents de la bibliothèque (downloads YouTube dont la fenêtre a été fermée sans « Ajouter ») sont listés à cocher et ajoutables sans toucher aux fichiers.
- **Annulation YouTube** : annuler un téléchargement quitte la modale d'import (plus de pseudo-erreur).

### Preuve forensique

Le smoke test kill a capturé `child-process-gone` en action : `Audio Service`, `Video Capture`, `Network Service`, `GPU` → `exitCode 143`, puis `[page] AudioContext…audio device` — la signature complète du crash `-1/143`. Au prochain crash réel, `soundfart.log` montrera si le fautif est le service audio Chromium.

### Vérifications

`node --check` ×6, `npm test` 57/57, `npm run dist` OK, smoke `--test-profile` : démarrage propre, `child-gone` opérationnel.

### « À valider » (suite)

- Micro USB rebranché : retour auto + plus de larsen (fix non testé en réel).
- Veille/réveil : audio reconstruit (fix non testé en réel).
- Voice gate : qualité vocale perçue (trop étouffé ? → régler ou `voiceDsp` off).
- Limite 45 s : lecture tronquée + toast ; YouTube 19 min désormais limité à 45 s de lecture.
- Restauration micro à la fermeture : retest utilisateur + lecture `[mic]` logs.
- Jauge enregistreur + bouton Écouter.

## Chantier audio-robustesse (16/11/2026, branche `fix/audio-robustness`)

Crash renderer `-1/143` (SF-REL-0611) + dette technique restante. Baseline : `npm test` 56/56, `node --check` OK, `npm run dist` OK, smoke exe propre (AudioContext créés, aucune erreur `[page]` nouvelle — les 7 occurrences `[page]` du log test datent du 15/11).

### Fait

- **Forensique crash** : `app.on('child-process-gone')` journalise type/raison/exitCode/serviceName — le service audio WebAudio de Chromium tourne dans un processus utilitaire dont les crashes n'étaient visibles ni dans `render-process-gone` ni forcément en dump Crashpad. Côté renderer, `devicechange` logue désormais les transitions cable/mon/mic (un device qui disparaît peut précéder le crash de quelques secondes).
- **`setDisplayMediaRequestHandler` réparé** : `getDisplayMedia({video:true,audio:true})` exige une source vidéo dans le callback — le handler renvoyait `{audio:'loopback'}` seul → requête refusée → **repli `systemStream` de l'enregistreur mort**. Fournit maintenant `sources[0]` (écran primaire, jamais lu — le renderer ne garde la vidéo que pour maintenir le loopback). **À valider en conditions réelles** (enregistrement « audio du PC » sans AudioTap).
- **`restoreMicNowP`/`restoreMicNow` dédupliqués** : logique de décision extraite (`micRestoreArgs` + `restoreMarker`) — la copie complète dérivait (même famille que `killTree` non injecté). Async et sync partagent désormais la même décision ; le sync reste synchrone avec budget 8 s pour `will-quit`.
- **`loudnessFromPcmAsync`** : moteur BS.1770 refactoré en `setup/stepRange/finish` — `loudnessFromPcm` synchrone strictement identique, variante async qui cède la main toutes les ~2 M frames. `measureForNorm` l'utilise + scan de pic par tranches : la normalisation ne gèle plus l'UI plusieurs secondes sur les fichiers longs. Test : async **bit-identique** au synchrone.

### Vérifications

`node --check` ×3, `npm test` **57/57** (+1 test d'équivalence async), `npm run dist` OK, smoke `--test-profile` propre.

### « À valider » / non vérifié

- Le repli `getDisplayMedia` n'est prouvé que statiquement (contrat API Electron) — test réel requis : enregistrer « audio du PC » en forçant l'échec d'AudioTap.
- `child-process-gone` : au prochain crash `-1/143`, vérifier que `[child-gone]` apparaît dans `soundfart.log` avec `serviceName` audio — c'est la donnée qui manque pour identifier le fautif.
- Restauration micro réelle (AudioEndpoint.exe) après refactor — non rejouée sur matériel.
- Auto-update : **abandonné pour le moment** (electron-updater ne supporte pas le format portable ; updater maison possible sans dépendance — décision reportée).

## Campagne de fiabilisation (15/11/2026)

Audit complet (3 revues parallèles + recherche documentaire) puis corrections par cycles, avec Quality Gate V2 (CLOSED exige cause + test + non-régression + revue indépendante + runtime + limites documentées).

**Chiffres canoniques dans `reliability/FINDINGS.md`** (registre de la campagne close — les anciens docs annonçaient 166, 168 ou 178 anomalies selon les dates ; seul FINDINGS fait foi) :

| Statut | Nombre |
|---|---|
| Anomalies uniques recensées | **168** |
| CLOSED | **144** |
| ACCEPTED (risques assumés documentés) | **23** |
| FIXED_PENDING_VALIDATION | **0** au tableau de bord (2 entrées isolées peuvent rester en attente — voir FINDINGS) |
| INVESTIGATING | **1** (SF-REL-0611 crash renderer AudioContext exitCode -1/143 — **cause racine indéterminée** ; la signature capturée est compatible avec la mort du process audio utility Chromium, mitigation en place, surveillance passive, jamais masqué) |

Corrections majeures : permissions `microphone` Electron 45 (écran vide/P0), PROPVARIANT ABI C#, `downloadFile` sans deadline + crash `res()`, yt-dlp single-flight, orchestrateur ffmpeg (zip via tar System32), restauration micro blindée (guard pid + watchdog), validation IPC `senderFrame`, config `.bak`/`.broken`, 51+ tests `node:test`.

**Restes connus** : validations matérielles en attente (voir `VALIDATION.md`), 27 ACCEPTED = compromis documentés (doublons de findings signalés dans FINDINGS §dédoublonnage), `npm audit` : 6 vulnérabilités modérées dans electron-builder (outil de build, non embarqué).

## Validations

- **Manuelle 15/11/2026** (machine réelle, `dist\SoundFart.exe`) : smoke limité détection périphériques, sortie casque, routage Discord, enregistrement micro+Discord, persistance après redémarrage — **5/5 OK** (ne couvre pas la campagne terrain complète du 16/11 — voir `VALIDATION.md`).
- **Automatisées** : `node --check`, `npm test` (54/54 au 16/11), `npm run dist`, smokes `--test-profile`, validations runtime agent (imports massifs, enregistreur multi-sources avec mesure RMS, rejouements ×10, kill brutal sans orphelins).
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

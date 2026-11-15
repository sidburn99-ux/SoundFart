# AUDIT_FIABILISATION.md — Revue complète et plan de fiabilisation

> Audit réalisé le 15 novembre 2026 sur `hardening/v2` (dernier commit `8f756f7`).
> **Mise à jour post-campagne** : les constats N1-N11, R1-R14, M2-M6, M9-M11,
> S1-S3, S5 ont été corrigés (commits `b35ae44`, `f334db6`, `a4e403a`,
> `2266528`). Restent assumés : M1 (`storageRoot`/`file:read` — choix
> fonctionnel documenté), M7, M8 (log synchrone — fiabilité > jank),
> M10 partiellement (dialog au 2ᵉ crash), N6 partiellement (moyenne
> boîte, pas de vrai filtre), R9 (fallback 'default' = choix utilisateur).
> Méthode : 3 revues de code parallèles (main/preload, renderer, C#/tests/scripts)
> + recherche documentaire (MS Learn WASAPI, Electron, pratiques soundboards).
> Chaque constat est classé : **bug avéré** / **risque** / **hypothèse** /
> **amélioration** / **fonctionnalité future**. Aucun code applicatif n'a été
> modifié pendant cet audit.

---

## 1. Architecture — état des lieux

```
main.js (1186 l.)     IPC, fenêtre, permissions, yt-dlp/ffmpeg, watchdog micro,
                      AudioTap/AudioEndpoint (compilation csc à la volée), config
preload.js            contextBridge : ~20 canaux, surface minimale
src/app.js (~2100 l.) renderer : UI, Web Audio, enregistreur, réglages, config
src/tap-processor.js  AudioWorklet : ring buffer PCM stéréo 48 kHz
lib/                  audio-utils.js (pur), media-permission.js (pur, testé)
AudioTap.cs           loopback WASAPI → PCM stdout (reconnexion bornée)
AudioEndpoint.cs      endpoints Windows : list/get/set/restore/guard
```

Points sains vérifiés : isolation stricte (`contextIsolation`, `sandbox`, CSP
`default-src 'self'`), tous les `ipcMain.handle` passent par `fromApp()`,
`will-navigate` bloqué, `windowOpen` deny, spawn/execFile en tableaux d'args,
SHA-256 sur les binaires téléchargés, config atomique + `.bak`, PCM aligné
8 octets, `timeBeginPeriod` appairé, killTree au quit.

Faiblesses structurelles : `app.js` ~2100 lignes monolithiques (lisible mais
dense), aucune couche de tests au-dessus de `lib/`, absence de tests
intégration renderer↔main et C#.

## 2. Bugs avérés (par ordre de gravité)

### Natif — priorité absolue

| # | Constat | Fichier | Gravité |
|---|---|---|---|
| N1 | **`PROPVARIANT` sous-dimensionné** : la struct C# fait 16 o (x64) au lieu de 24 o natifs ; `GetValue`/`PropVariantClear` peuvent écrire hors limites. Présent dans `AudioTap.cs` et `AudioEndpoint.cs`. `PropVariantClear` déclaré `void` alors que l'API retourne `HRESULT`. | `AudioTap.cs:39,82-87,270-277`, `AudioEndpoint.cs:64-72,107-114` | **Critique** |
| N2 | **`IAudioClient::Start()` non vérifié** : `src.Start()`/`dst.Start()` dans `InitTap()` sans test de HRESULT — un échec laisse un contexte "actif" mort. | `AudioTap.cs:452-459` | **Élevé** |
| N3 | **Restauration micro incomplète** : `SetDefault` ne jette que si les 3 rôles échouent ; `RestoreFromFile` supprime `audio-restore.json` même sur échec partiel → restauration partielle définitive. | `AudioEndpoint.cs:160-170,229-230` | **Élevé** |
| N4 | **Fuite `GetMixFormat`** : `Fmt.FromPtr` throw avant le `try/finally` → `srcFmtPtr`/`dstFmtPtr` fuient à chaque retry. | `AudioTap.cs:366-369` | Moyen |
| N5 | **`Fmt.SameAs` ignore `isFloat`** : int32 vs float32 considérés identiques → mauvaise conversion en mode non-PCM. | `AudioTap.cs:124-131` | Moyen |
| N6 | **Pas d'anti-aliasing** au downsampling (96→48 kHz) : aliasing réel par construction. | `AudioTap.cs:228-258` | Moyen (qualité) |
| N7 | **`audio-restore.json` ne stocke pas le rôle `multi`** : restauration non fidèle si les 3 rôles différaient avant bascule. | `main.js:856` + `AudioEndpoint.cs:220-229` | Moyen |
| N8 | **Formats exotiques** : `cbSize` non vérifié avant lecture `SubFormat` ; 24 bits/float non-32 rejetés sans fallback ; validation incomplète. | `AudioTap.cs:143-199` | Moyen |
| N9 | **Boucle `S_` silence** : `AUDCLNT_S_BUFFER_EMPTY` peut boucler ~500 appels COM par itération. | `AudioTap.cs:520-544` | Moyen (CPU) |
| N10 | **Guard micro** : pas de retry si le process parent est momentanément inaccessible ; parsing JSON par regex fragile ; écriture non atomique côté main. | `AudioEndpoint.cs:203-271`, `main.js:856` | Faible-Moyen |
| N11 | **Backpressure PCM** : AudioTap→stdout→IPC→worklet sans borne de bout en bout ; le ring buffer ne drop que côté worklet. | `AudioTap.cs:567-574`, `main.js:953-963`, `tap-processor.js` | Moyen (latent) |

### Renderer

| # | Constat | Fichier | Gravité |
|---|---|---|---|
| R1 | **`bufCacheBytes` dérive à la hausse** : `removeSound`/`relocateSound`/`mediaCut` ne décrémentent pas le compteur → le cache 256 Mo s'auto-désactive progressivement (éviction prématurée). | `app.js:731` (+259-263, 1010, 1413) | **Moyen (bug avéré)** |
| R2 | **`modal()` : Escape/backdrop ne résout jamais les promesses** → `confirmBox`/`askText`/`askDestDir` pendent à jamais ; un Escape pendant `askDestDir` **perd silencieusement l'enregistrement** (blob détruit, aucun message). | `app.js:170-177, 1058-1076, 1658` | **Moyen (perte de données utilisateur)** |
| R3 | **`editSound` + `confirmBox` (mediaCut)** : `modal()` détruit `editSound` → modifications non enregistrées perdues + `save()` implicite sur éléments détachés. | `app.js:1009-1040` | Moyen |
| R4 | **`previewBtn` mort** : `disabled:true` jamais retiré → « ▶ Écouter » ne peut jamais tirer. | `app.js:1474` | Faible (feature cassée) |
| R5 | **YouTube `offProg` jamais réarmé** après `askDestDir` ; annulation = modale perdue, tout à ressaisir. | `app.js:1830-1838,1921` | Faible-Moyen |
| R6 | **AudioTap non arrêté** si le worklet échoue avant repli `systemStream` → capture loopback orpheline pendant l'enregistrement. | `app.js:1630-1639` | Faible |
| R7 | **Promesses non catchées** : `addPaths`, `reveal`, `pickDir`, `audioAutoSetup().then()` — rejets non gérés (bruit console, contre l'esprit « erreurs surfacées »). | `app.js` ×~10 sites | Faible |
| R8 | **`getBuffer` fragile** : suppose `Uint8Array` désérialisé ; un `ArrayBuffer` pur casserait tous les décodages. | `app.js:240-241` | Faible (latent) |
| R9 | **`micDev` fallback → `'default'`** peut retomber sur CABLE Output = micro enregistre la soundboard. | `app.js:344` | Moyen (selon config) |
| R10 | **`cablePresent()` ignore `devicesDegraded`** → faux écran VB-CABLE / faux banner Discord sur énumération dégradée. | `app.js:439` | Faible-Moyen |
| R11 | **Enregistreur `actx` jamais `resume()`** → enregistrement silencieux possible si suspendu ; `rec.onerror` sauvegarde le partiel comme "succès" ; `micSel` fallback `devs[0]` non trié peut prendre un virtuel. | `app.js:1616,1465,1646-1649` | Moyen |
| R12 | **`normalizeCfg` import** : ne valide pas les types de `micMix`/`autoSwitchMic`/etc. ni les conflits de raccourcis avec les accesseurs menu → `'false'` string = truthy. | `app.js:121-129` | Faible (import seulement) |
| R13 | **Sortie `interrupted` sans retry** : statechange logué mais aucun rebuild auto — sortie morte jusqu'au prochain devicechange. | `app.js:278+` | Moyen |
| R14 | **`pcmQ` copies** : `postMessage(ab)` clone chaque chunk PCM (fréquence élevée) ; transfer list possible. | `app.js:1441-1446`, `tap-processor.js` | Faible (perf) |

### Main process

| # | Constat | Fichier | Gravité |
|---|---|---|---|
| M1 | **`storageRoot(dir)` accepte tout chemin absolu** du renderer → écriture arbitraire de `.mp3`/`.webm` n'importe où (config importée ou renderer compromis). Pas d'injection shell, mais surface large. | `main.js:397-415,326-341,665-705,832-870` | **Moyen-Majeur** |
| M2 | **`uncaughtException` : pas de quit + 3×`execFileSync` 15 s** → jusqu'à 45 s de blocage total du main dans un état potentiellement corrompu. | `main.js:1165-1171` | **Moyen-Majeur** |
| M3 | **Processus non trackés** : `tar` (extraction ffmpeg, 5 min), `csc`, `powershell`, `yt-dlp --version` via `execFileP` → orphelins possibles au quit ; `runYt` timeout `p.kill()` sans `killTree` → ffmpeg enfant orphelin. | `main.js:377-379,617,745,532,574` | Moyen |
| M4 | **`yt:download` pas de single-flight** → deux imports concurrents = bande passante doublée, progression entrelacée, `renameSync` update possible pendant exécution. | `main.js:665-705` | Faible-Moyen |
| M5 | **`audio:autoSetup` pas de mutex** → appels concurrents = guards `AudioEndpoint` dupliqués, clignotement micro. | `main.js:832-870` | Faible-Moyen |
| M6 | **`shortcuts:apply`** : élément `null` dans `entries` → TypeError avant `unregisterAll` ; **`yt:info` `JSON.parse(stdout)` non protégé**. | `main.js:303,660` | Faible |
| M7 | **`file:read`** : tout audio absolu lisible, Buffer ≤512 Mo sur IPC → pic RAM double en import massif. | `main.js:266-272` | Faible-Moyen |
| M8 | **`log()` synchrone** (`statSync`+`appendFileSync` par ligne) : spam stderr AudioTap/ui:log → jank main. | `main.js:41-55` | Faible |
| M9 | **`setDisplayMediaRequestHandler`** ne vérifie pas `request.frame`/origine (contrairement à `permOriginOk`) — surface faible car navigation verrouillée. | `main.js:1146-1158` | Faible |
| M10 | **Un seul reload renderer** après crash : second crash = UI morte sans diagnostic utilisateur. | `main.js:1090-1098` | Faible |
| M11 | **`config:load` fallback `.bak`** non validé comme objet ; `config:save` sans fsync (acceptable). | `main.js:201-238` | Faible |

### Scripts / outillage

| # | Constat | Fichier | Gravité |
|---|---|---|---|
| S1 | **`test-env.bat` ne neutralise pas `ELECTRON_RUN_AS_NODE`** — le piège exact d'AGENTS.md ; peut aussi préférer un `win-unpacked` stale. | `test-env.bat` | Moyen |
| S2 | **`build.bat` ignore `errorlevel`** et annonce « Termine » même si le build échoue. | `build.bat:10-14` | Moyen |
| S3 | **`regen-suivi.ps1`** : backtick/`${` non échappés dans le TSV injecté → template literal cassable ; pas de `-Encoding UTF8` (PS 5.1 corrompt les accents). | `regen-suivi.ps1` | Moyen |
| S4 | **`package.json` sans `engines`** : AGENTS.md dit Node ≥18 mais electron@45 exige ≥22.12. | `package.json` | Faible |
| S5 | **Test tautologique** `findCableCapture` comparé à lui-même ; test "placeholder" de `media-permission.test.js` ne passe pas par le code réel (couverture illusoire assumée dans le commentaire). | `test/audio-utils.test.js:44`, `test/media-permission.test.js:56-69` | Faible |
| S6 | **`double.TryParse` sensible à la culture** ; `SetDefault` ignore `flow` ; `VIRTUAL_RE` basé sur le nom ; `PropVariantClear` pas en `finally` (BSTR) ; encodage console non UTF-8 ; HRESULT `GetCount`/`GetBufferSize`/`ReleaseBuffer` ignorés ; `catch {}` sur `GetId` (violation règle projet). | `AudioTap.cs`, `AudioEndpoint.cs` | Faible |

## 3. Analyse audio Windows (WASAPI)

Référence : [MS Learn — Recovering from an Invalid-Device Error](https://learn.microsoft.com/en-us/windows/win32/coreaudio/recovering-from-an-invalid-device-error), [Stream Routing Implementation Considerations](https://learn.microsoft.com/en-us/windows/win32/coreaudio/stream-routing-implementation-considerations).

**Conforme aux bonnes pratiques** : libération complète avant ré-init, re-résolution du device (l'id peut changer après replug), format renégocié à chaque reconnexion, retries bornés (5) avec backoff — identique à la stratégie documentée par MS et au fix réel [windowsSpin PR #55](https://github.com/chrisuthe/windowsSpin/pull/55) (5 retries backoff → Error).

**Écarts restants** :
- Pas d'`IMMNotificationClient` : la détection se fait par erreur `DEVICE_INVALIDATED` à l'usage, pas par notification proactive — un device retiré *sans* flux actif n'est détecté qu'au prochain `enumerateDevices`/devicechange Chromium. Acceptable pour ce périmètre (AudioTap n'est actif qu'en enregistrement).
- `AUDCLNT_E_SERVICE_NOT_RUNNING` (service audio arrêté) : couvert par le retry borné, mais 5 essais × ~2,5 s ≈ 15 s peut être insuffisant pour un `net stop/start audiosrv` long — à valider en réel.
- Mode exclusif non utilisé (partagé seul) — correct pour un soundboard.
- Format 24 bits rejeté : à documenter comme limite ou ajouter un fallback 24→32 int.

## 4. Matrice des risques / scénarios de panne

| Scénario | Cause probable | Détection | Gravité | État |
|---|---|---|---|---|
| Casque USB retiré en lecture | device invalidated (rendu Chromium/Web Audio) | `statechange`/`interrupted` logué, toast 1ʳᵉ transition | Moyen | Risque — pas de rebuild auto (R13) |
| Défaut Windows changé | `setSinkId`/devicechange | devicechange debounce → re-resolve | Faible | Couvert partiellement |
| Micro débranché | getUserMedia NotFound / devicechange | log + toast permission | Moyen | Couvert |
| VB-CABLE retiré | endpoints absents | `cablePresent` → écran install | Faible | Couvert (sauf R10 dégradé) |
| Discord restart | changement device comm | watchdog micro 30 s + restoreFile | Moyen | Couvert (guards dupliqués M5) |
| Permission révoquée | handlers `[perm]` | logs DENY + warnPermOnce | Faible | Couvert (8f756f7) |
| Énumération échoue | placeholders deviceId vide | `devicesDegraded` → ids conservés | Faible | Couvert |
| Fichier >150 Mo | garde pré-décodage | toast + skip cache | Faible | Couvert |
| Format exotique (24 bit, >2 canaux) | `InitTap` throw après 5 retries | exit code 2 → `tapDead` toast | Moyen | Limite documentée |
| Multi-enregistrements | `recorderModal` slot unique | un seul `rec` à la fois | Faible | Couvert |
| Arrêt brutal pendant enregistrement | will-quit → killTree + restoreMic | blob perdu (normal) | Faible | Couvert |
| Corruption config | SyntaxError → `.broken` + `.bak` | fallback | Faible | Couvert ; `.bak` non validé (M11) |
| Conflit raccourcis | dedupe normalizeCfg + failed[] | toast | Faible | Couvert ; import peut créer conflit menu (R12) |
| yt-dlp/ffmpeg bloqué | timeouts 2 min / killTree | rejet IPC + log | Moyen | Partiel (M3, M4) |
| Fuite mémoire longue session | heap télémétrie 60 s | `[heap]` log | Inconnu | Télémétrie seule, non mesuré |
| **Escape pendant askDestDir** | promesse pendante | **rien — enregistrement perdu** | **Moyen** | **Bug avéré R2** |
| **PROPVARIANT débordement** | ABI mismatch | latent/crash aléatoire | **Critique** | **Bug avéré N1** |
| **Start() WASAPI échoué** | hr non vérifié | spin/log incompréhensible | **Élevé** | **Bug avéré N2** |

## 5. Audit des tests

Couverture actuelle : `npm test` = 23 tests sur `lib/audio-utils.js` +
`lib/media-permission.js` uniquement. **Rien** ne teste `main.js`, `app.js`,
`AudioTap.cs`, `AudioEndpoint.cs`, les scripts.

Stratégie proposée par niveaux :

1. **Unitaire (existant, à compléter)** : audio-utils, media-permission ; ajouter
   `tapPcmRem`-like alignement, `normalizeCfg` (types + conflits menu),
   `ytProgress`, `decideMediaPermission` edges. Corriger le test tautologique S5.
2. **Intégration main** : extraire les fonctions pures de `main.js` (storageRoot,
   ytProgress, tapPcm align) dans `lib/` testables ; tester handlers IPC via
   mock Electron léger ou tests de contrat preload↔main (canaux exposés =
   handlers enregistrés — test automatique possible en parsant les sources).
3. **Non-régression audio (manuel outillé)** : `VALIDATION.md` existe ; ajouter
   une checklist « release gate » exécutée avant chaque fusion (les 5 validations
   du 15/11 y figurent déjà partiellement).
4. **Charge/mémoire** : script de lecture en boucle 2-4 h + relevé heap
   (`[heap]` log) — manuel, à planifier.
5. **Matériel réel** : VALIDATION.md §C/§D — USB replug, `audiosrv`, Discord pair.

## 6. Benchmark soundboards (faits vs avis)

Sources : docs MS Learn (ci-dessus), retours GitHub documentés
([electron#4931](https://github.com/electron/electron/issues/4931) — labels
vides sans gUM ; [windowsSpin#55](https://github.com/chrisuthe/windowsSpin/pull/55)
— même stratégie de reconnexion que SoundFart), articles [Doyensec sur les
permissions Electron](https://blog.doyensec.com/2022/09/27/electron-api-default-permissions.html).

Constats : (a) SoundFart gère déjà les permissions mieux que le défaut Electron
(doyensec recommande un handler strict — c'est fait) ; (b) la reconnexion
WASAPI bornée est la pratique standard (MS + windowsSpin) ; (c) les soundboards
commerciaux (Soundpad/Voicemod) n'ont pas de doc technique publique — leurs
pratiques internes ne sont pas vérifiables ; ne rien en déduire. **Non
constaté** : benchmark chiffré de latence — non mesurable sans instrument.

## 7. Plan de fiabilisation priorisé

### P0 — Défauts critiques (cette mission, avant fusion)

| # | Tâche | Pourquoi | Complexité | Fichiers | Retour arrière |
|---|---|---|---|---|---|
| P0-1 | **Corriger `PROPVARIANT`** : `IntPtr` + `AllocCoTaskMem`/`PropVariantInit`, `PropVariantClear(IntPtr)` | Corruption mémoire ABI latente dans les 2 outils audio | Moyenne | `AudioTap.cs`, `AudioEndpoint.cs` | git revert |
| P0-2 | **Vérifier `src.Start()`/`dst.Start()`** dans `InitTap` | Flux mort silencieux | Faible | `AudioTap.cs` | git revert |
| P0-3 | **`SetDefaultEndpoint` strict par rôle** + ne pas supprimer `audio-restore.json` sur échec partiel | Restauration micro potentiellement perdue | Faible-Moyenne | `AudioEndpoint.cs` | git revert |
| P0-4 | **`modal()` : résoudre les promesses sur close** (resolve null/false) | Perte silencieuse d'enregistrement (R2) | Moyenne | `app.js` | git revert |

### P1 — Fiabilisation importante

- R1 `bufCacheBytes` (cacheDelete) ; R6 `audioTapStop` au repli ; R8 `getBuffer` ArrayBuffer ; R9 fallback micro ; R10 `cablePresent` dégradé ; R11 `actx.resume()` + `rec.onerror` ≠ succès ; R13 retry sortie `interrupted` ; M3 orphelins (`execFileTracked` partout) ; M4 single-flight `yt:download` ; M5 mutex `audio:autoSetup` ; M2 décision `uncaughtException` (quitter après restore ou documenter) ; M1 borner `storageRoot` ; S1 `test-env.bat` ELECTRON_RUN_AS_NODE ; S2 `build.bat` errorlevel ; S3 `regen-suivi.ps1` échappement+UTF8.
- N4-N9 : fuite GetMixFormat, `SameAs` isFloat, anti-aliasing (ou downsampling par décimation documenté), format 24 bits fallback, `S_` streak, rôle `multi` dans restoreFile.
- Tests : corriger tautologie S5, couvrir normalizeCfg/ytProgress, contrat IPC preload↔main.

### P2 — Préventif / observabilité

- Log `[perm]` déjà en place ; ajouter métriques PCM (drops worklet comptés), état AudioTap dans `ui:log` ; `file:read` en stream au lieu de Buffer 512 Mo ; `log()` async ou throttlé ; `rendererReloads` → dialog utilisateur au 2ᵉ crash ; `displayMedia` vérif frame ; `.bak` validation forme ; fsync config.

### P3 — Préparation futures features (vocodeur, effets, raccourcis par son)

- Le graphe Web Audio (`makeOutput`, bus/limiter, worklet tap) est déjà modularisé → bon point d'accroche pour des `AudioNode` d'effet **par voix** ; éviter d'introduire un moteur parallèle.
- `app.js` monolithique : avant d'ajouter des features, extraire modules (engine audio, recorder, library, settings) — refactor justifié par la taille, pas préventif.
- Raccourcis par son : `normalizeCfg`/`findShortcutOwner` devront valider contre les accesseurs menu de façon centralisée (aujourd'hui liste hardcodée `app.js:647` — divergence garantie quand le menu évolue).
- Normalisation volume : `computeNorm` existe (échantillonnage 200k pts) — insuffisant pour un pic étroit ; un vrai pic-search serait nécessaire pour une feature « normalize ».

## 8. Points à protéger pour les futures évolutions

1. Contrat PCM 8 octets/frame stéréo 48 kHz — toute feature audio doit respecter l'alignement.
2. `audio-restore.json` = seul marqueur de restauration micro — ne jamais restaurer sans lui.
3. `fromApp()` sur chaque handler IPC + `permOriginOk` — toute nouvelle surface IPC/reseau doit passer par là.
4. `devicesDegraded` : une énumération dégradée ne doit JAMAIS écraser ids/labels configurés.
5. `childProcs`/`killTree` : tout nouveau spawn/execFile DOIT passer par `execFileTracked`/`trackChild`.
6. Fenêtre `modal()` unique : les flows multi-étapes (edit→confirm) doivent utiliser des modales dédiées, jamais `confirmBox` depuis une modale parente.
7. Versions épinglées + SHA-256 pour tout binaire externe futur.

## 9. Recommandation pré-fusion `hardening/v2` → `main`

**Ne pas fusionner en l'état.** Le P0 utilisateur (permissions) est corrigé et
validé manuellement, mais l'audit révèle :
- 1 bug ABI critique latent (N1 PROPVARIANT) — peut corrompre la mémoire du
  processus audio à tout moment ;
- 1 perte de données utilisateur avérée (R2 Escape pendant askDestDir) ;
- 1 restauration micro potentiellement incomplète (N3).

Fusion acceptable après : P0-1 à P0-4 corrigés + `npm test` vert + build dist +
au moins un smoke réel (détection + lecture + enregistrement). La validation
matérielle complète (VALIDATION.md §C/§D) peut rester post-fusion si documentée.

## 10. Dix actions les plus pertinentes (ordre d'importance)

1. **N1 — PROPVARIANT** : refactor en `IntPtr`/`AllocCoTaskMem` dans les 2 `.cs`. Impact : élimine une corruption mémoire potentiellement aléatoire.
2. **R2 — `modal()` promesses pendantes** : `close()` doit résoudre `null`/`false`. Impact : fin de la perte silencieuse d'enregistrements.
3. **N2/N3 — `Start()` WASAPI + restauration stricte** : flux audio et micro Windows sans angle mort.
4. **R1 — `bufCacheBytes`** : le cache 256 Mo refonctionne (aujourd'hui il se vide tout seul avec l'usage).
5. **M3 — orphelins processus** : `execFileTracked`/`killTree` sur tar/csc/powershell/ffmpeg-enfant.
6. **S1/S2/S3 — scripts** : `ELECTRON_RUN_AS_NODE` dans test-env, errorlevel build, échappement regen-suivi. Coût faible, fiabilité outillage immédiate.
7. **M1 — borner `storageRoot`** : whitelist de racines (userData + dossiers config validés).
8. **M2 — décider `uncaughtException`** : quitter après restauration micro (recommandé) ou documenter le choix de continuer.
9. **Tests non-régression** : contrat IPC preload↔main automatique + normalizeCfg/ytProgress unitaires + corriger la tautologie.
10. **VALIDATION.md release gate** : figer les 5 validations manuelles du 15/11 comme checklist obligatoire avant chaque fusion.

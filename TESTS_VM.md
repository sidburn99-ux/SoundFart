# Plan de test manuel — VM Windows 11 propre (Intégrité de la mémoire activée)

> Rôle : plan de test manuel sur VM Windows propre (10 cas, résultats attendus). Statut : **actuel**, à rejouer après chaque changement audio/packaging. À consulter : avant une release ou après une modif de la chaîne audio.

Pré-requis VM : Windows 11 à jour, « Intégrité de la mémoire » (Core Isolation → Memory integrity) **activée** et vérifiée dans Sécurité Windows → Sécurité de l'appareil → Détails de l'isolation de la mémoire. Compte admin. **Pas de VB-CABLE** au départ. Micro réel ou micro Windows fonctionnel. Discord installé + compte de test (idéalement un 2ᵉ compte sur un 2ᵉ PC/VM pour l'appel à deux).

Copier `dist\SoundFart.exe` **seul** dans un dossier de test (ex. `C:\SoundFart-test\`). Ne rien d'autre à côté au départ.

> **Modèle de données actuel** : réglages/outils/logs dans `%APPDATA%\SoundFart` (= `C:\Users\<user>\AppData\Roaming\SoundFart`), fichiers audio créés dans le **dossier de sons choisi** à la première utilisation. `SoundFart-data` n'est plus créé — il n'existe plus que comme **source de migration** unique (voir cas 10).

---

## Cas 1 — Premier lancement sans VB-CABLE

1. Double-cliquer `SoundFart.exe`.
2. **Attendu** : fenêtre en ~2-5 s ; écran « VB-CABLE requis » centré avec le gros bouton « Télécharger VB-CABLE (page officielle) » et l'adresse `vb-audio.com/Cable` visible ; bandeau « Discord désactivé : VB-CABLE manquant » **au-dessus** de la barre du haut ; la bibliothèque (5 sons par défaut) est utilisable ; **aucune bascule micro** (vérifier Paramètres → Système → Son → Entrée : ton vrai micro reste par défaut).
3. Cliquer « Télécharger VB-CABLE » → **Attendu** : la page officielle s'ouvre dans le navigateur **uniquement après le clic** (jamais automatiquement).
4. Fermer l'écran via « Plus tard » → il reste ré-ouvrable via ⚙ Réglages → « Installer VB-CABLE… ».
5. **Vérifier** : la **bannière « Choisis ton dossier de sons »** apparaît en haut (skippable — la création d'un son la reproposera). Choisir par ex. `C:\sf-sons` → les 5 sons par défaut sont copiés dans `C:\sf-sons\sons\`. Dans `%APPDATA%\SoundFart\` : `config.json`, `soundfart.log`, `default-sounds\` ; `tools\` n'est créé **qu'au premier usage réel** (bascule micro ou import) — son absence ici est normale. **Rien n'est créé à côté de l'exe.**

## Cas 2 — Installation manuelle de VB-CABLE

1. Télécharger depuis vb-audio.com/Cable, dézipper, clic droit `VBCABLE_Setup_x64.exe` → « Exécuter en tant qu'administrateur » → Install → redémarrer.
2. Après reboot, lancer `SoundFart.exe` → **Attendu** : plus d'écran d'accueil ; « CABLE Input »/« CABLE Output » visibles dans les périphériques ; bandeau disparu.
3. Variante : installer le pilote **sans redémarrer** puis cliquer « J'ai installé, vérifier » → **Attendu** : message suggérant le redémarrage (les endpoints n'apparaissent qu'après reboot).

## Cas 3 — Bascule micro automatique

1. Réglages → « Bascule micro automatique » ✅ (défaut), « Sortie vers Discord » = `CABLE Input`, « Écoute locale » = casque.
2. Lancer `SoundFart.exe` → **Attendu** : toast « Entrée micro basculée sur CABLE Output » **au lancement** (la bascule a lieu à la détection du câble, pas au clic sur Appliquer) ; Paramètres Windows → le micro par défaut = CABLE Output. À l'« Appliquer » ultérieur, pas de nouveau toast si rien n'a changé.
3. Fermer SoundFart proprement → **Attendu** : le micro revient sur le périphérique d'origine (ex. G930).
4. Vérifier `%APPDATA%\SoundFart\audio-restore.json` : absent après fermeture propre.

## Cas 4 — Double lancement

1. Lancer `SoundFart.exe` deux fois → **Attendu** : une seule fenêtre ; la 2ᵉ sortie immédiatement ; le micro **reste** sur CABLE Output si la 1ʳᵉ a basculé (pas de restauration parasite).

## Cas 5 — Kill du processus (crash simulé)

1. Avec la bascule micro active, ouvrir le Gestionnaire des tâches → terminer `SoundFart.exe` **sans** fermer proprement.
2. **Attendu** : en ≤ ~2-3 s le micro revient sur le périphérique d'origine (garde `AudioEndpoint.exe guard <pid>` détachée) ; `audio-restore.json` supprimé ; au prochain lancement tout est normal.
3. Variante matérielle : couper la VM / BSOD → au prochain boot, les endpoints audio persistent → `audio:autoSetup` voit déjà le bon micro et **ne restaure rien au lancement** ; la restauration différée n'a lieu qu'à la prochaine fermeture propre de SoundFart ou via le bouton manuel (tant que `audio-restore.json` existe).

## Cas 6 — Bouton « Restaurer mon micro Windows »

1. Avec la bascule auto active (donc `audio-restore.json` présent), forcer l'entrée Windows sur un **autre** périphérique (ex. « CABLE Output » ou un autre micro) pendant que SoundFart tourne.
2. ⚙ Réglages → « Restaurer mon micro Windows » → **Attendu** : l'entrée redevient le périphérique d'origine mémorisé (vrai micro / défaut Windows non virtuel) ; `audio-restore.json` consommé.
3. **Contre-test obligatoire** : supprimer `audio-restore.json` (ou ne jamais basculer) puis cliquer « Restaurer mon micro Windows » → **Attendu** : **rien ne se passe** — SoundFart ne touche jamais un micro qu'il n'a pas lui-même basculé (choix manuel respecté, même sur périphérique virtuel).

## Cas 7 — Appel Discord à deux + enregistrement « Audio du PC »

1. Appel vocal Discord entre la VM et un 2ᵉ participant (depuis un autre PC/casque pour ne pas s'entendre soi-même).
2. Dans Discord : entrée = « Défaut » (ou CABLE Output), sortie = casque.
3. SoundFart : jouer un son → **Attendu** : le participant l'entend ; **tu ne l'entends pas en double** (écoute locale = casque).
4. Enregistreur → cocher « Audio du PC » (+ micro) → enregistrer ~30 s de conversation → arrêter → ouvrir le fichier.
5. **Attendu** : l'enregistrement contient **les voix Discord ET les sons SoundFart**, **sans écho** pour le participant (vérifier en rejouant l'enregistrement et en demandant au participant s'il s'entendait en double pendant l'appel).
6. Pendant l'enregistrement, débrancher le casque → **Attendu** : message « source Audio du PC perdue » ou arrêt propre, pas de plantage.

## Cas 8 — Surveillance micro (watchdog)

1. Basculer le micro active ; pendant que SoundFart tourne, changer le micro par défaut dans Windows → **Attendu** : toast « surveillance auto suspendue » (une seule fois) ; le micro **n'est pas** re-basculé (choix utilisateur respecté).

## Cas 9 — Suppression de l'exe en cours d'usage

1. Lancer SoundFart, puis essayer de supprimer/déplacer `SoundFart.exe` → **Attendu** : Windows refuse (fichier verrouillé) — normal pour un exe en cours d'exécution ; après fermeture, suppression possible.

## Cas 10 — Migration `SoundFart-data` → `%APPDATA%` et persistance

C'est **le** test du profil vierge : sur la VM, le premier lancement migre automatiquement toute ancienne donnée portable.

1. **Préparer la source** : créer `SoundFart-data\` à côté de l'exe contenant un `config.json` réel (exporté depuis une install SoundFart existante) + `sons\` avec 1-2 fichiers audio + `imports\` avec 1 fichier. Le `config.json` doit référencer les sons via des chemins `...\SoundFart-data\sons\...` et avoir `settings.storageDir` pointant sur `SoundFart-data` (ou un sous-dossier).
2. Lancer `SoundFart.exe` → **Attendu** : migration au démarrage — log `[migration] copie ...` ; dans `%APPDATA%\SoundFart\` : `config.json` réécrit (chemins → `%APPDATA%\SoundFart\...`), `.migrated-from-portable` présent, `audio-restore.json` repris si présent ; les sons sont **jouables** (chemins résolus) ; bannière dossier de sons si `storageDir` absent.
3. **Collision** : pré-remplir `%APPDATA%\SoundFart\sons\` avec un fichier de **même nom mais contenu différent** avant le lancement → **Attendu** : le fichier AppData est conservé, la version `SoundFart-data` copiée sous `*.portable.*`, et la bibliothèque joue le **bon** contenu (log `[migration] ... renommes (collision)`).
4. Fermer, **supprimer `SoundFart-data`**, relancer → **Attendu** : tout fonctionne depuis `%APPDATA%` (rien n'est perdu, rien n'est recréé à côté de l'exe).
5. Variante : déplacer `SoundFart.exe` seul vers un autre dossier → relancer → **Attendu** : bibliothèque et réglages **inchangés** (ils vivent dans `%APPDATA%`, plus rien ne suit l'exe).

---

## Résultats à noter

| Cas | Résultat | Constat |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |

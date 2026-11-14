# Plan de test manuel — VM Windows 11 propre (Intégrité de la mémoire activée)

Pré-requis VM : Windows 11 à jour, « Intégrité de la mémoire » (Core Isolation → Memory integrity) **activée** et vérifiée dans Sécurité Windows → Sécurité de l'appareil → Détails de l'isolation de la mémoire. Compte admin. **Pas de VB-CABLE** au départ. Micro réel ou micro Windows fonctionnel. Discord installé + compte de test (idéalement un 2ᵉ compte sur un 2ᵉ PC/VM pour l'appel à deux).

Copier `dist\SoundFart.exe` **seul** dans un dossier de test (ex. `C:\SoundFart-test\`). Ne rien d'autre à côté au départ.

---

## Cas 1 — Premier lancement sans VB-CABLE

1. Double-cliquer `SoundFart.exe`.
2. **Attendu** : fenêtre en ~2-5 s ; écran « VB-CABLE requis » centré avec le gros bouton « Télécharger VB-CABLE (page officielle) » et l'adresse `vb-audio.com/Cable` visible ; bandeau « Discord désactivé : VB-CABLE manquant » sous la barre du haut ; la bibliothèque (sons par défaut ou config migrée) est utilisable ; **aucune bascule micro** (vérifier Paramètres → Système → Son → Entrée : ton vrai micro reste par défaut).
3. Cliquer « Télécharger VB-CABLE » → **Attendu** : la page officielle s'ouvre dans le navigateur **uniquement après le clic** (jamais automatiquement).
4. Fermer l'écran via « Plus tard » → il reste ré-ouvrable via ⚙ Réglages → « Installer VB-CABLE… ».
5. **Vérifier** : `SoundFart-data\` créé à côté de l'exe avec `config.json`, `tools\`, `soundfart.log`.

## Cas 2 — Installation manuelle de VB-CABLE

1. Télécharger depuis vb-audio.com/Cable, dézipper, clic droit `VBCABLE_Setup_x64.exe` → « Exécuter en tant qu'administrateur » → Install → redémarrer.
2. Après reboot, lancer `SoundFart.exe` → **Attendu** : plus d'écran d'accueil ; « CABLE Input »/« CABLE Output » visibles dans les périphériques ; bandeau disparu.
3. Variante : installer le pilote **sans redémarrer** puis cliquer « J'ai installé, vérifier » → **Attendu** : message suggérant le redémarrage (les endpoints n'apparaissent qu'après reboot).

## Cas 3 — Bascule micro automatique

1. Réglages → « Bascule micro automatique » ✅ (défaut), « Sortie vers Discord » = `CABLE Input`, « Écoute locale » = casque.
2. Appliquer → **Attendu** : toast « Entrée micro basculée sur CABLE Output » ; Paramètres Windows → le micro par défaut = CABLE Output.
3. Fermer SoundFart proprement → **Attendu** : le micro revient sur le périphérique d'origine (ex. G930).
4. Vérifier `SoundFart-data\audio-restore.json` : absent après fermeture propre.

## Cas 4 — Double lancement

1. Lancer `SoundFart.exe` deux fois → **Attendu** : une seule fenêtre ; la 2ᵉ sortie immédiatement ; le micro **reste** sur CABLE Output si la 1ʳᵉ a basculé (pas de restauration parasite).

## Cas 5 — Kill du processus (crash simulé)

1. Avec la bascule micro active, ouvrir le Gestionnaire des tâches → terminer `SoundFart.exe` **sans** fermer proprement.
2. **Attendu** : en ≤ ~2-3 s le micro revient sur le périphérique d'origine (garde `AudioEndpoint.exe guard <pid>` détachée) ; `audio-restore.json` supprimé ; au prochain lancement tout est normal.
3. Variante matérielle : couper la VM / BSOD → au prochain boot, lancer SoundFart → la restauration a déjà eu lieu via le guard ou se fait au lancement.

## Cas 6 — Bouton « Restaurer mon micro Windows »

1. Reproduire un blocage : forcer l'entrée Windows sur « CABLE Output » manuellement pendant que SoundFart tourne, puis fermer SoundFart de façon à ce que l'état soit perdu (ou simuler en supprimant `audio-restore.json` après une bascule manuelle).
2. ⚙ Réglages → « Restaurer mon micro Windows » → **Attendu** : l'entrée redevient un périphérique non virtuel (vrai micro ou défaut Windows).

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

## Cas 10 — Données portables

1. Fermer SoundFart, déplacer `SoundFart.exe` **avec** son dossier `SoundFart-data` vers un autre emplacement → relancer → **Attendu** : ta bibliothèque/config est toujours là.
2. Supprimer `SoundFart-data` et relancer → **Attendu** : 5 sons par défaut + écran VB-CABLE si le pilote est resté installé → plus d'écran (câble toujours présent).

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

# SoundFart 💨

> Rôle : présentation du projet (ce que c'est, fonctionnalités, installation rapide). Statut : **actuel**. À consulter : en premier, pour une vue d'ensemble ; détails dans `GUIDE.md` et `SPECIFICATION.md`.

Soundboard Windows pour Discord : joue des sons dans tes appels, enregistre ta voix et le son du PC, importe depuis YouTube. **Application portable** — un seul `SoundFart.exe`, aucune installation.

## Fonctionnalités

- **Bibliothèque de sons** : catégories, favoris, miniatures, recherche, tri, volume par son
- **Édition non destructive** : découpe début/fin, fondus d'entrée/sortie, normalisation — l'original n'est jamais modifié
- **Raccourcis clavier** par son + raccourci global **STOP** (interrompt tout, même fenêtre minimisée)
- **Enregistreur intégré** : micro, audio du PC (loopback WASAPI sans repasser par le câble) et sortie SoundFart→Discord
- **Import YouTube** : extrait MP3 par timeline ou fichier audio complet, avec progression
- **Routage Discord** : sortie vers `CABLE Input`, micro Windows basculé automatiquement sur `CABLE Output` à la lancement et restauré à la fermeture (même après crash)
- **Réglages audio** : sortie Discord, écoute locale casque, mixage micro, surveillance automatique du micro
- **Sauvegarde** : export/import de la configuration (références, catégories, découpes, raccourcis)

## Prérequis

- **Windows 10/11 64 bits**
- **[VB-CABLE](https://vb-audio.com/Cable/)** (gratuit) — requis pour envoyer les sons dans Discord. **À installer toi-même** depuis la page officielle (SoundFart ne l'embarque pas, licence VB-Audio). L'app affiche un écran d'invitation s'il est absent.
- Discord : en voix, choisis **« Défaut »** comme périphérique d'entrée pour suivre la bascule automatique du micro.

## Utilisation

1. Déplace/lance `SoundFart.exe` (conserve le dossier `SoundFart-data` à côté — il contient ta config, tes outils et tes logs)
2. Si VB-CABLE est absent, l'écran d'accueil t'invite à le télécharger ; installe-le, redémarre Windows si besoin, puis « J'ai installé, vérifier »
3. Réglages → audio : choisis **« CABLE Input »** (surligné ★) comme sortie Discord et ton casque comme écoute locale
4. Clique un son (ou son raccourci) pour le jouer

> ⚠️ L'exe n'est **pas signé** → SmartScreen peut afficher un avertissement au 1er lancement (« Informations complémentaires » → Exécuter).

## Développement

```
npm install
npm start          # lance en dev
npm test           # tests unitaires (node:test)
npm run dist       # build portable -> dist\SoundFart.exe
```

- Stack : Electron 45, JS vanilla, C# compilé à la volée (`csc.exe`), yt-dlp + ffmpeg téléchargés et vérifiés (SHA-256)
- `AGENTS.md` : règles de dev · `GUIDE.md` : guide utilisateur · `SPECIFICATION.md` : spec technique · `JOURNAL.md` : historique · `suivi.tsv` : journal technique · `reliability/FINDINGS.md` : registre des anomalies · `VALIDATION.md` / `TESTS_VM.md` : plans de test

## Licence

Voir `THIRD-PARTY-NOTICES`. VB-CABLE est © VB-Audio et n'est pas redistribué.

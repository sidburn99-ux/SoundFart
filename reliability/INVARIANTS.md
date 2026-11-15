# INVARIANTS — propriétés devant rester toujours vraies

## Audio / PCM
- I1 : PCM AudioTap = float32 stéréo 48 kHz = 8 octets/frame ; tout découpage aligné sur 8 o.
- I2 : worklet tap-processor : outputChannelCount [2], numberOfInputs 0, flush avant rec.start.
- I3 : AudioTap ne sort jamais de données PCM sur stdout en mode non-pcm (protocoles JSON/commandes).
- I4 : toute ressource COM/ Wasapi ouverte a un chemin de libération sur TOUT chemin d'erreur.

## Données utilisateur
- I5 : jamais modifier originaux audio, SoundFart-data, config, tools\.
- I6 : config.json écrit atomiquement + .bak ; corrompu -> .broken-<ts> + fallback.
- I7 : restauration micro UNIQUEMENT si audio-restore.json existe ; jamais écraser choix manuel.
- I8 : VB-CABLE jamais bundlé/installé automatiquement.

## Sécurité
- I9 : contextIsolation, nodeIntegration:false, sandbox:true préservés.
- I10 : permissions limitées à l'origine index.html ; caméra refusée ; decisions journalisées.
- I11 : yt-dlp/ffmpeg versions épinglées + SHA-256 ; YouTube hosts uniquement ; runYt timeout.

## Processus
- I12 : aucun catch{} silencieux masquant un diagnostic.
- I13 : tout processus enfant spawné est tracké et tué (killTree) au quit/timeout.
- I14 : promesse jamais pendante : toute modale/fermeture résout ou rejette.

## Git
- I15 : travail uniquement sur hardening/v2 ; main jamais modifiée ni mergée ; pas de force-push.

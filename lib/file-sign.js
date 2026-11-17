// Signatures de fichiers pour la dedoublonnage d'import.
// sameFileQuick (taille + 4 Kio tete + 4 Kio queue) est un FILTRE rapide :
// deux fichiers differents peuvent coincider sur ces echantillons. Quand il
// matche, on confirme par SHA-256 complet — un faux positif ne doit jamais
// substituer silencieusement un fichier utilisateur different.
const fs = require('fs');
const crypto = require('crypto');

async function sha256File(p) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', resolve);
  });
  return h.digest('hex');
}

// Vrai seulement si les deux fichiers ont EXACTEMENT le meme contenu.
// Taille verifiee par l'appelant (ou ici pour les usages autonomes).
async function sameFileContent(a, b) {
  const [sa, sb] = await Promise.all([fs.promises.stat(a), fs.promises.stat(b)]);
  if (sa.size !== sb.size) return false;
  const [ha, hb] = await Promise.all([sha256File(a), sha256File(b)]);
  return ha === hb;
}

module.exports = { sha256File, sameFileContent };

// Decision de permission audio — fonction pure, testable via node:test.
//
// Electron 45 / Chromium recent : getUserMedia({audio}) et l'exposition des
// labels/deviceId dans enumerateDevices passent par la permission 'microphone',
// DISTINCTE de 'media'. Un handler qui n'accorde que 'media' refuse donc le
// micro -> enumerateDevices ne retourne que des placeholders vides
// (deviceId='') et permissions.query('microphone') = 'denied'.
function decideMediaPermission(permission, details) {
  const types = details && Array.isArray(details.mediaTypes) ? details.mediaTypes : null;
  switch (permission) {
    case 'microphone':
      // Par definition audio seul — c'est LE correctif de la regression P0.
      return { allow: true, reason: 'acces micro (audio)' };
    case 'media':
      // mediaTypes absent : Chromium ne precise pas la nature de la demande.
      // L'app ne demande jamais de video via getUserMedia ; refuser ici
      // reproduirait le bug des placeholders vides. On autorise et on
      // journalise — un appel video explicite porte 'video' dans mediaTypes.
      if (!types || types.length === 0) return { allow: true, reason: 'media sans mediaTypes (audio suppose)' };
      if (types.every((t) => t === 'audio')) return { allow: true, reason: 'audio seul' };
      return { allow: false, reason: 'video demandee: ' + types.join(',') };
    case 'display-capture':
      // Repli loopback de l'enregistreur : getDisplayMedia exige une piste
      // video, donc setDisplayMediaRequestHandler accorde sources[0] SANS
      // dialogue quand videoRequested — la page obtient un flux ecran
      // complet (surface reduite a la page locale file://, origine verifiee).
      return { allow: true, reason: 'loopback audio enregistreur' };
    default:
      return { allow: false, reason: 'permission non autorisee' };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { decideMediaPermission };

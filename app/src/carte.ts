// Saisie d'une carte dans nos propres formulaires (comptoir, MichelIA+), sur le web.

// Le pavé numérique du téléphone n'a ni espace ni « / » : on les pose nous-mêmes en tapant.
export const formatNumero = (t: string) =>
  t.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

export const formatExpiration = (t: string) => {
  // Saisie automatique du navigateur, parfois en MM/AAAA.
  const auto = t.match(/^\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/);
  if (auto) return `${auto[1].padStart(2, '0')}/${auto[2].slice(2)}`;
  let chiffres = t.replace(/\D/g, '');
  // Un mois qui commence par 2 à 9 ne peut être que 02 à 09.
  if (/^[2-9]/.test(chiffres)) chiffres = `0${chiffres}`;
  chiffres = chiffres.slice(0, 4);
  return chiffres.length > 2 ? `${chiffres.slice(0, 2)}/${chiffres.slice(2)}` : chiffres;
};

// La carte telle que la fonction l'attend, ou null si la forme ne va pas (le serveur revérifie tout).
export function carteSaisie(numero: string, expiration: string, cvc: string) {
  const date = expiration.replace(/\s/g, '').match(/^(\d{1,2})\/?(\d{2}|\d{4})$/);
  const chiffres = numero.replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(chiffres) || !date || !/^\d{3,4}$/.test(cvc.trim())) return null;
  return { numero: chiffres, mois: Number(date[1]), annee: Number(date[2]), cvc: cvc.trim() };
}

// La page 3D Secure vient de la banque (adresse donnée par Stancer, relayée par notre serveur) : https seulement.
export const pageSecure = (url: unknown): url is string => {
  try {
    return typeof url === 'string' && new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

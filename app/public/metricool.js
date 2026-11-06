// Compteur de visites Metricool de michel.beer (pages vues, d'où l'on vient, taille de l'écran).
// Même accord que Google Analytics : rien ne part sans le « J'accepte » du bandeau du chat
// (clé michelia:cookies), ou data-accord="oui" quand le chat charge ce fichier juste après le clic.
// C'est l'équivalent du be.js de Metricool, en local : aucun script tiers ne tourne sur le site,
// seule une image de 1 pixel est demandée à tracker.metricool.com, sans cookie.
// Jamais hors de michel.beer (applis de bureau, extension, aperçus), ni sur /comptoir et
// /la-cotisation (champs de carte, PCI DSS 6.4.3), ni avec le jeton de désabonnement des e-mails.
(function () {
  if (location.hostname !== 'michel.beer' || /^\/(comptoir|la-cotisation)/.test(location.pathname)) return;
  var script = document.currentScript;
  var accord = script && script.getAttribute('data-accord');
  try {
    accord = accord || localStorage.getItem('michelia:cookies');
  } catch (e) {}
  if (accord !== 'oui') return;
  var page = new URL(location.href);
  page.searchParams.delete('desabonnement');
  var donnees = { hash: '401f72596d730636ed282be2806c90e9', u: page.href, bw: innerWidth, bh: innerHeight };
  // D'où l'on vient, sans les paramètres : l'adresse précédente peut porter le jeton de désabonnement
  // (lien d'e-mail /?desabonnement=… renvoyé vers /chat, même site, donc referrer complet).
  if (document.referrer) {
    try {
      var ref = new URL(document.referrer);
      donnees.ref = ref.origin + ref.pathname;
    } catch (e) {}
  }
  new Image().src = 'https://tracker.metricool.com/c3po.jpg?' + new URLSearchParams(donnees);
})();

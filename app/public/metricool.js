// Compteur de visites Metricool de michel.beer (pages vues, d'où l'on vient, taille de l'écran),
// et bandeau cookies des pages du site (accueil, Nouveautés, Ça mijote, pages légales).
// Même accord que Google Analytics dans le chat (clé michelia:cookies, « oui » ou « non ») : rien ne
// part sans « J'accepte ». Le chat charge ce fichier avec data-accord="oui" juste après le clic, et
// a son propre bandeau (src/CookieBanner.tsx, même texte) : ici, pas de second bandeau dans ce cas.
// C'est l'équivalent du be.js de Metricool, en local : aucun script tiers ne tourne sur le site,
// seule une image de 1 pixel est demandée à tracker.metricool.com, sans cookie.
// Jamais hors de michel.beer (applis de bureau, extension, aperçus), ni sur /comptoir et
// /la-cotisation (champs de carte, PCI DSS 6.4.3), ni avec le jeton de désabonnement des e-mails.
(function () {
  if (location.hostname !== 'michel.beer' || /^\/(comptoir|la-cotisation)/.test(location.pathname)) return;
  var CLE = 'michelia:cookies';
  var script = document.currentScript;
  var depuisLeChat = script && script.getAttribute('data-accord') === 'oui';
  var envoye = false;

  function lire() {
    try {
      return localStorage.getItem(CLE);
    } catch (e) {
      return null;
    }
  }

  function compter() {
    if (envoye) return;
    envoye = true;
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
  }

  if (depuisLeChat) return compter();

  var bandeau = null;
  function choisir(oui) {
    try {
      localStorage.setItem(CLE, oui ? 'oui' : 'non');
    } catch (e) {}
    if (oui) compter();
    if (bandeau) bandeau.remove();
    bandeau = null;
  }

  function montrer() {
    if (bandeau) return;
    var style = document.createElement('style');
    style.textContent =
      '.michel-cookies{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:12px;z-index:50;pointer-events:none}' +
      '.michel-cookies div{pointer-events:auto;width:100%;max-width:560px;box-sizing:border-box;background:#fff;color:#2B2420;border-radius:14px;padding:16px;box-shadow:0 4px 16px rgba(60,40,20,.18);font:14px/20px system-ui,-apple-system,sans-serif}' +
      '.michel-cookies p{margin:0 0 12px}' +
      '.michel-cookies span{display:flex;gap:10px}' +
      '.michel-cookies button{flex:1;height:42px;border:0;border-radius:10px;background:#7A2E1D;color:#fff;font:700 15px system-ui,-apple-system,sans-serif;cursor:pointer}' +
      '.michel-cookies button:active{opacity:.6}';
    bandeau = document.createElement('section');
    bandeau.className = 'michel-cookies';
    bandeau.setAttribute('aria-label', 'Cookies');
    bandeau.innerHTML =
      '<div role="alert"><p>Dis, une petite chose : Michel aimerait compter les visites avec Google Analytics et Metricool, pour ' +
      "savoir si on vient le voir. Pas de pub, et tes questions ne partent ni chez l'un ni chez l'autre.</p>" +
      '<span><button type="button" data-choix="non">Refuser</button><button type="button" data-choix="oui">J\'accepte</button></span></div>';
    bandeau.appendChild(style);
    bandeau.addEventListener('click', function (e) {
      var choix = e.target && e.target.getAttribute && e.target.getAttribute('data-choix');
      if (choix) choisir(choix === 'oui');
    });
    document.body.appendChild(bandeau);
  }

  // Le lien « Cookies » du pied de page rouvre le bandeau pour changer d'avis.
  document.addEventListener('click', function (e) {
    var lien = e.target && e.target.closest && e.target.closest('[data-cookies]');
    if (!lien) return;
    e.preventDefault();
    montrer();
  });

  var choix = lire();
  if (choix === 'oui') compter();
  else if (choix !== 'non') montrer();
})();

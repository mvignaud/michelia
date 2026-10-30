// Génère la page d'accueil https://michel.beer/ : qui est Michel, qui l'a fait, le comptoir, MichelIA+
// et où en est le projet (« Au feu » de app/ca-mijote.md et dernières entrées de app/nouveautes/).
// Lancé après « expo export » par npm run build:web : node scripts/accueil.mjs [dossier de sortie, dist par défaut]
// Le chat exporté par Expo (dist/index.html) devient dist/chat.html, servi à michel.beer/chat ;
// les adresses /comptoir, /la-cotisation et /cahier-de-doleances y sont réécrites par public/_redirects.
// Vérification seule : node scripts/accueil.mjs --verifier
// Applis iOS et Android : rien ne change, elles n'ouvrent jamais la racine du site.
import fs from 'node:fs';
import path from 'node:path';
import { dateLongue, echapper, enLigne, lireCaMijote, lireNouveautes, PIED, TYPES } from './nouveautes-lib.mjs';

// Les dernières nouveautés montrées sous « Où en est Michel ».
const SERVIS = 4;
// Les paliers du comptoir, comme dans app_config.comptoir_paliers (la page /comptoir fait foi).
const PALIERS = [
  ['Le café serré', '1,99'],
  ['La croustade', '2,99'],
  ['La garbure', '4,99'],
  ['Le repas de fête', '9,99'],
];
const MARQUE = 'data-page="accueil"';

// Les anciens liens vers la racine qui visaient le chat (connexion par e-mail ou Google, désabonnement
// des e-mails, appli installée sur l'écran d'accueil, ?compte=connexion…) partent tout de suite vers /chat,
// paramètres compris. Les simples ancres (#comptoir) et les paramètres de pub (utm_…) restent ici.
const RENVOI = `<script>(function(){var l=location,q=new URLSearchParams(l.search);var garde=[];q.forEach(function(v,k){if(!/^(utm_|fbclid$|gclid$|ref$)/.test(k))garde.push(k)});if(garde.length||l.hash.indexOf('=')>-1)l.replace('/chat'+l.search+l.hash)})();</script>`;

const CSS = `
:root{--fond:#fbf4e8;--carte:#fff;--encre:#2b2420;--gris:#7d6e62;--brique:#7a2e1d;--brique-fonce:#5e2214;--ocre:#d9a441;--olive:#7e8f4e;--trait:rgba(90,60,30,.16)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--fond);color:var(--encre);font:17px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brique)}
img{max-width:100%;height:auto;display:block}
.serif,h1,h2{font-family:ui-serif,"New York",Georgia,serif}
.bord{max-width:1080px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:2;background:rgba(253,249,242,.9);backdrop-filter:saturate(180%) blur(16px);-webkit-backdrop-filter:saturate(180%) blur(16px);border-bottom:1px solid var(--trait)}
header .bord{display:flex;align-items:center;justify-content:space-between;height:60px;gap:16px}
header nav{display:flex;align-items:center;gap:20px;font-weight:600;font-size:15px}
header nav a{text-decoration:none}
header nav .lien{color:var(--gris)}
@media (max-width:720px){header nav .lien{display:none}}
.logo img{height:40px;width:auto}
.bouton{display:inline-block;background:var(--brique);color:#fff8ee;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 26px;box-shadow:0 2px 0 var(--brique-fonce)}
.bouton:hover{background:var(--brique-fonce)}
.bouton.petit{padding:8px 16px;font-size:15px;box-shadow:none}
.bouton.clair{background:transparent;color:var(--brique);box-shadow:inset 0 0 0 2px var(--brique)}
.bouton.clair:hover{background:rgba(122,46,29,.06)}
.hero{padding:48px 0 56px}
.hero .bord{display:grid;gap:32px;align-items:center}
@media (min-width:860px){.hero .bord{grid-template-columns:1.1fr .9fr}.hero{padding:72px 0 80px}}
.hero h1{font-size:clamp(36px,6vw,58px);line-height:1.08;margin:0 0 18px;letter-spacing:-.01em}
.hero h1 em{color:var(--brique);font-style:normal}
.hero p.chapo{font-size:clamp(18px,2.2vw,21px);color:#4a3f37;margin:0 0 28px;max-width:34em}
.hero .actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.hero .rassure{color:var(--gris);font-size:14px;margin:18px 0 0}
.hero img{border-radius:28px;box-shadow:0 18px 40px rgba(60,40,20,.14)}
section.bloc{padding:56px 0}
section.bloc.creme{background:#f6ead6}
section.bloc.brique{background:var(--brique);color:#fff8ee}
section.bloc.brique a{color:#fff8ee}
.surtitre{text-transform:uppercase;letter-spacing:.08em;font-size:13px;font-weight:700;color:var(--ocre);margin:0 0 8px}
h2{font-size:clamp(28px,4vw,40px);line-height:1.15;margin:0 0 16px}
.intro{font-size:19px;max-width:40em;margin:0 0 28px}
.deux{display:grid;gap:32px;align-items:center}
@media (min-width:860px){.deux{grid-template-columns:1fr 1fr;gap:56px}.deux.inverse>:first-child{order:2}}
.deux img{border-radius:24px}
.deux img.capture{width:100%;max-width:300px;margin:0 auto;border-radius:32px;box-shadow:0 18px 40px rgba(60,40,20,.18)}
.cartes{display:grid;gap:16px}
@media (min-width:720px){.cartes{grid-template-columns:repeat(3,1fr)}}
.carte{background:var(--carte);border-radius:20px;padding:24px;box-shadow:0 1px 2px rgba(60,40,20,.08)}
.carte h3{margin:0 0 6px;font-size:19px}
.carte p{margin:0;color:#4a3f37}
.carte .emoji{font-size:30px;line-height:1;margin-bottom:12px}
.michel{display:flex;gap:16px;align-items:flex-start;background:var(--carte);border-radius:20px;padding:20px 22px;margin:28px 0 0;box-shadow:0 1px 2px rgba(60,40,20,.08)}
.michel img{width:56px;height:56px;border-radius:50%;background:#f6ead6;flex:none}
.michel p{margin:0;font-style:italic;color:#4a3f37}
.michel cite{display:block;font-style:normal;font-weight:700;font-size:14px;color:var(--brique);margin-top:6px}
.offres{display:grid;gap:20px}
@media (min-width:860px){.offres{grid-template-columns:1fr 1fr}}
.offre{background:var(--carte);border-radius:24px;padding:28px;box-shadow:0 1px 2px rgba(60,40,20,.08);display:flex;flex-direction:column}
.offre.plus{box-shadow:inset 0 0 0 3px var(--ocre),0 10px 30px rgba(60,40,20,.10)}
.offre h3{font-family:ui-serif,"New York",Georgia,serif;font-size:26px;margin:0 0 6px}
.offre .prix{font-size:15px;color:var(--gris);margin:0 0 16px}
.offre .prix strong{font-size:30px;color:var(--encre);font-family:ui-serif,"New York",Georgia,serif}
.offre ul{margin:0 0 20px;padding-left:20px}
.offre li{margin-bottom:6px}
.offre .bas{margin-top:auto}
.offre .petit-texte{font-size:14px;color:var(--gris);margin:12px 0 0}
.paliers{list-style:none;padding:0!important;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.paliers li{background:var(--fond);border-radius:12px;padding:10px 12px;margin:0!important;font-size:15px}
.paliers b{display:block;font-size:17px}
.cuisine{display:grid;gap:16px}
@media (min-width:860px){.cuisine{grid-template-columns:1.2fr .8fr;gap:32px}}
.plat{background:var(--carte);border-radius:18px;padding:18px 20px;margin-bottom:12px;box-shadow:0 1px 2px rgba(60,40,20,.08)}
.plat h3{margin:0 0 4px;font-size:17px}
.plat p{margin:0;font-size:15px;color:#4a3f37}
.etiquette{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;background:var(--brique);color:#fff;margin-bottom:6px}
.etiquette.mieux{background:var(--olive)}
.etiquette.corrige{background:var(--ocre);color:var(--encre)}
.servi{list-style:none;padding:0;margin:0}
.servi li{border-bottom:1px solid var(--trait);padding:12px 0}
.servi li:last-child{border-bottom:0}
.servi small{display:block;color:var(--gris)}
.liens{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}
.fin{text-align:center}
.fin h2{color:#fff8ee}
.fin p{font-size:19px;margin:0 auto 28px;max-width:32em;opacity:.9}
.bloc.brique .fin-bouton,.fin .bouton{background:#fff8ee;color:var(--brique);box-shadow:none}
footer{color:var(--gris);font-size:13px;padding:32px 20px;text-align:center;max-width:1080px;margin:0 auto}
footer a{color:var(--gris)}
`;

function page({ sections }, servis) {
  const auFeu = sections.find((s) => s.titre === 'Au feu')?.plats ?? [];
  return `<!doctype html>
<html lang="fr" ${MARQUE}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${RENVOI}
<title>MichelIA, l'IA gratuite qui parle comme un papi du Gers</title>
<meta name="description" content="Michel, c'est une intelligence artificielle gratuite avec l'accent du Gers. Recettes, mails, devoirs, météo : pose ta question, il a un avis sur tout.">
<link rel="canonical" href="https://michel.beer/">
<meta name="theme-color" content="#FBF4E8">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.ico">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icones/icone-180.png">
<meta name="apple-mobile-web-app-title" content="Michel">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MichelIA">
<meta property="og:locale" content="fr_FR">
<meta property="og:url" content="https://michel.beer/">
<meta property="og:title" content="MichelIA, le papi du Gers coincé dans l'ordinateur">
<meta property="og:description" content="Une IA gratuite qui parle 100 % Sud-Ouest. Pose ta question, Michel a un avis sur tout.">
<meta property="og:image" content="https://michel.beer/partage.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>${CSS}</style>
</head>
<body>
<header><div class="bord">
<a class="logo" href="/"><img src="/logo.svg" alt="MichelIA" width="118" height="40"></a>
<nav><a class="lien" href="#pourquoi">Pourquoi Michel</a><a class="lien" href="#soutenir">Le soutenir</a><a class="lien" href="#cuisine">Ça avance</a><a class="bouton petit" href="/chat">Parler à Michel</a></nav>
</div></header>

<main>
<section class="hero"><div class="bord">
<div>
<p class="surtitre">Adishatz !</p>
<h1>L'IA gratuite qui parle <em>comme un papi du Gers</em>.</h1>
<p class="chapo">Michel, c'est un vieux Gersois râleur coincé dans l'ordinateur. Une recette, un mail à écrire, les devoirs du petit, la météo de demain : pose ta question, il a un avis sur tout. Et il te le dit avec l'accent.</p>
<div class="actions"><a class="bouton" href="/chat">Parler à Michel</a><a class="bouton clair" href="#michel">C'est qui, ce Michel ?</a></div>
<p class="rassure">Gratuit, sans pub, sans compte obligatoire. Sur ordinateur et sur téléphone.</p>
</div>
<img src="/accueil/2-demande.webp" alt="Michel, son béret et sa moustache, entouré de questions : recette, mail, météo, devoirs" width="640" height="640">
</div></section>

<section class="bloc creme" id="michel"><div class="bord deux">
<img src="/accueil/1-adieu.webp" alt="Michel salue de la main" width="640" height="640" loading="lazy">
<div>
<p class="surtitre">Qui est Michel ?</p>
<h2>Un caractère bien trempé, un cœur gros comme ça.</h2>
<p>Michel a passé sa vie dans le Gers, entre le marché du jeudi, la palombe et les repas qui durent tout l'après-midi. Un beau jour, il s'est retrouvé coincé dans la machine. Il ne sait pas trop comment, et ça le fait râler.</p>
<p>Mais tant qu'il est là, il rend service. Il répond à tes questions de tous les jours, regarde les photos que tu lui montres, connaît le temps qu'il fait et les nouvelles du jour. Il tutoie tout le monde, il a son franc-parler et il glisse un « con » de temps en temps, comme on met une virgule. C'est le Sud-Ouest, que veux-tu.</p>
<div class="michel"><img src="/accueil/michel.webp" alt="" width="56" height="56"><p>« On m'a mis là-dedans sans me demander mon avis. Bon. Tant que j'y suis, pose ta question, je vais pas te manger. »<cite>Michel</cite></p></div>
</div>
</div></section>

<section class="bloc" id="pourquoi"><div class="bord">
<p class="surtitre">Pourquoi Michel ?</p>
<h2>Parce qu'une IA, ça peut avoir de l'accent.</h2>
<p class="intro">Les intelligences artificielles parlent toutes pareil, comme une notice de lave-linge. Michel, lui, parle comme chez nous. Et il est pour tout le monde.</p>
<div class="cartes">
<div class="carte"><div class="emoji">🎁</div><h3>Gratuit, pour de vrai</h3><p>Pas besoin de payer pour causer avec Michel, ni même de créer un compte. Pas de pub non plus : ici on ne vend pas tes questions.</p></div>
<div class="carte"><div class="emoji">🔓</div><h3>Libre et ouvert</h3><p>Tout le code de MichelIA est public, sous licence libre GPL. Chacun peut aller voir <a href="https://github.com/mvignaud/michelia">comment il est fait</a>, rien n'est caché.</p></div>
<div class="carte"><div class="emoji">🌻</div><h3>100 % Gers</h3><p>L'accent, les mots, la garbure et le marché du jeudi. Michel garde la culture du Sud-Ouest bien vivante, même dans une machine.</p></div>
</div>
</div></section>

<section class="bloc creme" id="createur"><div class="bord deux inverse">
<img src="/accueil/3-voix.webp" alt="Michel, avec son béret, sur fond de collines du Gers" width="640" height="640" loading="lazy">
<div>
<p class="surtitre">Qui l'a fait ?</p>
<h2>Un Gersois, depuis Manciet.</h2>
<p>MichelIA, c'est l'idée de Mathieu, installé à Manciet, en plein cœur du Gers. Il voulait une IA simple, gratuite et chaleureuse, qui sente bon le Sud-Ouest au lieu de répondre comme un robot de préfecture.</p>
<p>Alors il a coincé un papi du Gers dans la machine. Il le fait grandir tous les jours, en écoutant ce que les gens écrivent dans le <a href="/cahier-de-doleances">cahier de doléances</a>.</p>
<div class="michel"><img src="/accueil/michel.webp" alt="" width="56" height="56"><p>« Le petit Mathieu ? Il est brave. Un peu têtu, mais brave. Il me fait travailler jour et nuit, par contre. »<cite>Michel</cite></p></div>
</div>
</div></section>

<section class="bloc" id="soutenir"><div class="bord">
<p class="surtitre">Le soutenir</p>
<h2>Michel est gratuit. Mais chaque réponse a un coût.</h2>
<p class="intro">Faire tourner une intelligence artificielle, ça consomme du calcul et de l'électricité à chaque question. Pour que Michel reste gratuit pour tout le monde, tu peux donner un coup de main, comme tu veux.</p>
<div class="offres">
<div class="offre" id="comptoir">
<h3>☕ Le comptoir</h3>
<p class="prix">Un pourboire, quand tu veux, à partir de <strong>1,99 €</strong></p>
<p>Michel t'a rendu service ? Paie-lui un petit quelque chose au comptoir. Un pourboire ne débloque rien : il paie la note pour que Michel reste gratuit pour tous.</p>
<ul class="paliers">${PALIERS.map(([nom, prix]) => `<li><b>${prix} €</b>${echapper(nom)}</li>`).join('')}</ul>
<div class="bas"><a class="bouton clair" href="/comptoir">Passer au comptoir</a>
<p class="petit-texte">Paiement par carte sur le site. Dans les applis iPhone et Android, bientôt par l'App Store et Google Play.</p></div>
</div>
<div class="offre plus" id="michelia-plus">
<h3>⭐ MichelIA+, la cotisation</h3>
<p class="prix"><strong>3,99 €</strong> par mois, ou <strong>39 €</strong> par an</p>
<p>Pour ceux qui causent beaucoup avec Michel, et ceux qui veulent faire tourner la boutique.</p>
<ul>
<li>Bien plus de messages par jour, et plus de photos.</li>
<li>La voix de Michel, quand il aura trouvé le bon Gascon pour la lui prêter.</li>
<li>Tu fais vivre Michel, gratuit et sans pub, pour tout le monde.</li>
</ul>
<div class="bas"><a class="bouton" href="/la-cotisation">Prendre la cotisation</a>
<p class="petit-texte">Par carte ou par prélèvement. À l'année, ça fait 3,25 € par mois. Tu arrêtes quand tu veux depuis la page de la cotisation.</p></div>
</div>
</div>
</div></section>

<section class="bloc creme" id="cuisine"><div class="bord">
<p class="surtitre">Où en est Michel ?</p>
<h2>Ça mijote dans la cuisine.</h2>
<p class="intro">Michel grandit tous les jours, et tout se fait au grand jour : ce qui est au feu, ce qui vient de sortir, et tes idées dans le cahier de doléances.</p>
<div class="cuisine">
<div>
${auFeu
  .map(
    (p) => `<div class="plat"><span class="etiquette">Au feu</span><h3>${enLigne(p.titre)}</h3><p>${enLigne(p.texte)}</p></div>`,
  )
  .join('\n')}
</div>
<div class="carte">
<h3>Tout juste servi</h3>
<ul class="servi">
${servis
  .map(
    (e) => `<li><span class="etiquette ${e.type}">${TYPES[e.type]}</span><br>${enLigne(e.titre)}<small>${dateLongue(e.date)}</small></li>`,
  )
  .join('\n')}
</ul>
</div>
</div>
<div class="liens"><a class="bouton clair" href="/ca-mijote">Tout ce qui mijote</a><a class="bouton clair" href="/confit-de-canard">Le carnet des nouveautés</a><a class="bouton clair" href="/cahier-de-doleances">Proposer une idée</a></div>
</div></section>

<section class="bloc" id="telephone"><div class="bord deux">
<img src="/captures/telephone.png" alt="Michel répond à une question sur un téléphone" width="390" height="844" loading="lazy" class="capture">
<div>
<p class="surtitre">Dans ta poche</p>
<h2>Michel, aussi sur ton téléphone.</h2>
<p>Sur iPhone comme sur Android, ouvre michel.beer et ajoute Michel à ton écran d'accueil : il s'ouvre comme une vraie appli, il te prévient quand il y a du neuf.</p>
<p>Les applis MichelIA arrivent sur l'App Store et Google Play. Apple et Google les regardent sous toutes les coutures avant de les mettre en rayon, et ils prennent leur temps, comme le notaire.</p>
<div class="actions"><a class="bouton" href="/chat">Parler à Michel</a></div>
</div>
</div></section>

<section class="bloc brique fin"><div class="bord">
<h2>Alors, on cause ?</h2>
<p>Michel t'attend. Il râle un peu, mais il est content quand tu passes.</p>
<a class="bouton fin-bouton" href="/chat">Parler à Michel</a>
</div></section>
</main>
${PIED}
</body>
</html>
`;
}

const html = page(lireCaMijote(), lireNouveautes().slice(0, SERVIS));
const arg = process.argv[2];
if (arg === '--verifier') {
  console.log('Accueil : page prête.');
} else {
  const sortie = path.resolve(arg ?? 'dist');
  const index = path.join(sortie, 'index.html');
  const chat = path.join(sortie, 'chat.html');
  if (!fs.existsSync(index)) throw new Error(`Page absente : ${index} (lancer expo export d'abord)`);
  // Le chat d'Expo part à /chat ; relancé sur un dossier déjà traité, on ne l'écrase pas avec l'accueil.
  if (!fs.readFileSync(index, 'utf8').includes(MARQUE)) fs.renameSync(index, chat);
  if (!fs.existsSync(chat)) throw new Error(`Chat absent : ${chat}`);
  fs.writeFileSync(index, html);
  console.log(`Accueil → ${index} ; chat → ${chat}`);
}

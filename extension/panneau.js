// Le panneau latéral : la causette avec Michel, le captcha et le petit menu du compte.
'use strict';

const $ = (id) => document.getElementById(id);
const fil = $('fil');
const saisie = $('saisie');
const question = $('question');
const envoyer = $('envoyer');
const etat = $('etat');

// Ce que Michel retient, comme dans l'appli : le prénom et la dernière causette, sur cet ordinateur seulement.
const MEMOIRE = 'michel:memoire';
const MAX_GARDES = 40;
let memoire = { name: undefined, messages: [] };
let enCours = null;
// Change à chaque « Nouvelle » : une réponse coupée de l'ancienne causette ne revient pas dans la nouvelle.
let causette = 0;

const ACCUEIL = [
  "Adieu ! Moi c'est Michel, du Gers. Pose-moi ta question, je te réponds franco, con.",
  "Té, de la visite ! Assieds-toi, et dis-moi ce qui te tracasse.",
  "Adieu ! Une recette, un mail à écrire, la météo ? Vas-y, je t'écoute.",
];

// ---------- Affichage ----------

// Mise en forme légère des réponses, comme app/src/RichText.tsx : **gras**, titres « # » et puces.
// Tout passe par textContent : rien de la réponse n'est jamais interprété comme du HTML.
function remplir(el, texte) {
  el.replaceChildren();
  texte.split('\n').forEach((brute, i) => {
    if (i > 0) el.append('\n');
    const ligne = brute.replace(/^#{1,6}\s+(.*)$/, '**$1**').replace(/^(\s*)[-*]\s+/, '$1• ');
    ligne.split(/\*\*(.+?)\*\*/g).forEach((morceau, j) => {
      if (j % 2) {
        const b = document.createElement('strong');
        b.textContent = morceau;
        el.append(b);
      } else if (morceau) el.append(morceau);
    });
  });
}

function bulle(message) {
  const el = document.createElement('div');
  el.className = `bulle ${message.role === 'user' ? 'moi' : 'michel'}${message.failed ? ' rate' : ''}`;
  remplir(el, message.content || '…');
  fil.append(el);
  return el;
}

function redessiner() {
  fil.replaceChildren();
  if (!memoire.messages.length) {
    const salut = ACCUEIL[Math.floor(Math.random() * ACCUEIL.length)];
    bulle({ role: 'assistant', content: memoire.name ? salut.replace('Adieu !', `Adieu ${memoire.name} !`) : salut });
  }
  memoire.messages.forEach(bulle);
  descendre();
}

function descendre() {
  fil.scrollTop = fil.scrollHeight;
}

function erreur(texte) {
  const el = document.createElement('div');
  el.className = 'erreur';
  el.textContent = texte;
  fil.append(el);
  descendre();
}

// ---------- Mémoire ----------

async function charger() {
  const gardee = await Michel.store.get(MEMOIRE);
  if (gardee && Array.isArray(gardee.messages)) {
    memoire = {
      name: typeof gardee.name === 'string' ? gardee.name : undefined,
      messages: gardee.messages.filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string'),
    };
  }
}

function sauver() {
  return Michel.store.set(MEMOIRE, { name: memoire.name, messages: memoire.messages.slice(-MAX_GARDES) });
}

// L'historique envoyé alterne strictement question / réponse : les questions restées sans réponse n'y vont pas.
function historique() {
  const paires = [];
  const ms = memoire.messages;
  for (let i = 0; i < ms.length - 1; i++) {
    if (ms[i].role === 'user' && !ms[i].failed && ms[i + 1].role === 'assistant' && ms[i + 1].content) {
      paires.push(ms[i], ms[i + 1]);
      i++;
    }
  }
  return paires;
}

// ---------- Causette ----------

async function demander(texte) {
  texte = texte.trim().slice(0, 4000);
  if (!texte || enCours) return;
  const moi = { role: 'user', content: texte };
  const envoi = [...historique(), moi];
  memoire.messages.push(moi);
  bulle(moi);
  const reponse = { role: 'assistant', content: '' };
  const el = bulle(reponse);
  el.classList.add('ecrit');
  descendre();
  occupe(true);
  const ici = causette;

  enCours = new AbortController();
  try {
    const { name } = await Michel.ask(
      envoi,
      memoire.name,
      (morceau) => {
        reponse.content += morceau;
        remplir(el, reponse.content);
        descendre();
      },
      enCours.signal,
    );
    if (name) memoire.name = name;
    if (!reponse.content) throw new Error('Michel est resté sans voix. Réessaie, con.');
    if (ici === causette) memoire.messages.push(reponse);
  } catch (e) {
    if (ici !== causette) return;
    if (reponse.content) memoire.messages.push(reponse);
    else {
      el.remove();
      moi.failed = true;
      fil.lastElementChild?.classList.add('rate');
      if (!enCours.signal.aborted) erreur(e instanceof Error ? e.message : String(e));
    }
  } finally {
    el.classList.remove('ecrit');
    enCours = null;
    occupe(false);
    if (ici === causette) await sauver();
  }
}

function occupe(oui) {
  envoyer.textContent = oui ? '■' : '➤';
  envoyer.title = oui ? 'Arrêter' : 'Envoyer';
  etat.textContent = oui ? 'Michel réfléchit, il se gratte la tête…' : 'Au comptoir, prêt à causer';
}

saisie.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (enCours) return enCours.abort();
  const texte = question.value;
  question.value = '';
  ajuster();
  demander(texte);
});

// Entrée envoie, Maj + Entrée passe à la ligne.
question.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    saisie.requestSubmit();
  }
});

function ajuster() {
  question.style.height = 'auto';
  question.style.height = `${Math.min(question.scrollHeight, 160)}px`;
}
question.addEventListener('input', ajuster);

$('nouvelle').addEventListener('click', async () => {
  causette++;
  if (enCours) enCours.abort();
  memoire.messages = [];
  await sauver();
  redessiner();
  question.focus();
});

// ---------- Texte envoyé par le clic droit « Demander à Michel » ----------

async function questionEnAttente() {
  const { question: texte } = await chrome.storage.session.get('question');
  if (!texte) return;
  await chrome.storage.session.remove('question');
  question.value = texte;
  ajuster();
  question.focus();
}
chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'session' && changes.question?.newValue) questionEnAttente();
});

// ---------- Captcha Turnstile ----------
// Il tourne dans la page michel.beer/captcha (le domaine déclaré chez Cloudflare), dans un cadre ;
// la page renvoie son jeton au panneau par postMessage.

const CAPTCHA_MS = 30_000;
function captcha() {
  return Michel.getConfig().then(
    ({ turnstileSiteKey }) =>
      new Promise((resolve, reject) => {
        if (!turnstileSiteKey) return resolve(undefined);
        const boite = $('captcha');
        const cadre = document.createElement('iframe');
        cadre.src = `${Michel.SITE}/captcha?k=${encodeURIComponent(turnstileSiteKey)}`;
        cadre.title = 'Vérification anti-robot';
        $('captcha-texte').textContent = "Michel vérifie que t'es pas un robot…";
        $('captcha-cadre').replaceChildren(cadre);
        boite.hidden = false;
        let delai = setTimeout(() => fin(), CAPTCHA_MS);
        function fin(jeton) {
          clearTimeout(delai);
          window.removeEventListener('message', ecoute);
          boite.hidden = true;
          cadre.remove();
          if (jeton) resolve(jeton);
          else reject(new Error('Vérification anti-robot échouée, réessaie.'));
        }
        function ecoute(ev) {
          if (ev.origin !== Michel.SITE || ev.source !== cadre.contentWindow || typeof ev.data !== 'string') return;
          if (ev.data.startsWith('token:')) fin(ev.data.slice(6));
          else if (ev.data === 'show') {
            // Une vraie case à cocher : on laisse le temps.
            clearTimeout(delai);
            $('captcha-texte').textContent = 'Coche la case, que je sache que t’es pas un robot.';
          } else fin();
        }
        window.addEventListener('message', ecoute);
      }),
  );
}
Michel.setCaptchaProvider(captcha);

// ---------- Compte ----------

async function afficherCompte() {
  const session = await Michel.getSession();
  const inscrit = session && !session.user.is_anonymous;
  $('compte-qui').textContent = inscrit
    ? `Connecté : ${session.user.email ?? 'membre'}`
    : 'Tu causes avec Michel en invité, avec le quota du jour des visiteurs.';
  $('connexion').hidden = !!inscrit;
  $('deconnexion').hidden = !inscrit;
}

$('menu').addEventListener('click', async () => {
  const boite = $('compte');
  boite.hidden = !boite.hidden;
  if (!boite.hidden) await afficherCompte();
});

$('connexion').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const bouton = ev.submitter;
  bouton.disabled = true;
  try {
    await Michel.signIn($('email').value.trim(), $('mdp').value);
    $('mdp').value = '';
    await afficherCompte();
    $('compte').hidden = true;
    bulle({ role: 'assistant', content: "Et beh, te voilà connecté ! Allez, on reprend où on en était, con." });
    descendre();
  } catch (e) {
    $('compte-qui').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    bouton.disabled = false;
  }
});

$('deconnexion').addEventListener('click', async () => {
  await Michel.signOut();
  await afficherCompte();
});

// ---------- Démarrage ----------

(async () => {
  await charger();
  redessiner();
  await questionEnAttente();
  question.focus();
})();

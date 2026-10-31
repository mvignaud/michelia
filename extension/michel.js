// Le client de Michel, sans dépendance : réglages publics, session Supabase et appel à la fonction « chat ».
// Même protocole que l'appli (app/src/chat.ts et app/src/supabase.ts), en appels HTTP directs pour
// éviter toute étape de construction. Aucune clé secrète ici : les réglages publics (adresse Supabase,
// clé publique, clé de site Turnstile) viennent de https://michel.beer/appli.json, généré au déploiement.
'use strict';

const Michel = (() => {
  const SITE = 'https://michel.beer';
  // Séparateur placé par la fonction avant ses informations de fin de réponse (le prénom retenu).
  const TRAILER = '\u001e';
  // Sans nouvelles de la fonction pendant ce temps, on coupe et on affiche une erreur.
  const SILENCE_MS = 60_000;
  // Comme la fonction : 20 messages d'historique au plus, 4 000 caractères par message.
  const MAX_HISTORY = 20;

  // Rangement : chrome.storage.local dans l'extension, localStorage ailleurs.
  const store = {
    async get(key) {
      if (globalThis.chrome?.storage?.local) return (await chrome.storage.local.get(key))[key];
      try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      if (globalThis.chrome?.storage?.local) return chrome.storage.local.set({ [key]: value });
      localStorage.setItem(key, JSON.stringify(value));
    },
    async remove(key) {
      if (globalThis.chrome?.storage?.local) return chrome.storage.local.remove(key);
      localStorage.removeItem(key);
    },
  };

  // Fournie par l'interface : affiche le captcha Turnstile et renvoie son jeton.
  let captchaProvider = async () => undefined;

  let config = null;
  async function getConfig() {
    if (config) return config;
    try {
      const res = await fetch(`${SITE}/appli.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const fresh = await res.json();
      if (!fresh.supabaseUrl || !fresh.supabaseAnonKey) throw new Error('réglages incomplets');
      config = fresh;
      await store.set('michel:config', fresh);
    } catch {
      // Hors ligne : les derniers réglages connus font l'affaire.
      config = (await store.get('michel:config')) ?? null;
      if (!config) throw new Error('Michel trouve pas le chemin du comptoir. Vérifie ta connexion, con.');
    }
    return config;
  }

  async function auth(path, body) {
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    const res = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      const err = new Error(authMessage(data));
      err.status = res.status;
      throw err;
    }
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
      user: { id: data.user?.id, email: data.user?.email, is_anonymous: !!data.user?.is_anonymous },
    };
    await store.set('michel:session', session);
    return session;
  }

  function authMessage(data) {
    const code = data.error_code ?? data.code ?? '';
    if (code === 'invalid_credentials') return 'E-mail ou mot de passe pas bon.';
    if (code === 'email_not_confirmed') return 'Confirme d’abord ton e-mail (regarde tes messages).';
    if (code === 'captcha_failed') return 'Vérification anti-robot échouée, réessaie.';
    if (code === 'over_request_rate_limit') return 'Doucement, trop d’essais. Attends un peu.';
    return data.msg ?? data.error_description ?? 'Connexion impossible, réessaie.';
  }

  async function getSession() {
    return (await store.get('michel:session')) ?? null;
  }

  // Comme l'appli : chaque visiteur reçoit un compte anonyme, qui porte le quota du jour.
  // Un seul renouvellement (ou une seule inscription) à la fois : les appels simultanés attendent le même.
  let enRoute = null;
  function getAccessToken() {
    enRoute ??= obtenirJeton().finally(() => (enRoute = null));
    return enRoute;
  }

  async function obtenirJeton() {
    const session = await getSession();
    if (session && session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    if (session?.refresh_token) {
      try {
        return (await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })).access_token;
      } catch (e) {
        if (!e.status || e.status >= 500) throw e;
        await store.remove('michel:session');
      }
    }
    const captcha_token = await captchaProvider();
    return (await auth('signup', { data: {}, gotrue_meta_security: { captcha_token } })).access_token;
  }

  async function signIn(email, password) {
    const captcha_token = await captchaProvider();
    return auth('token?grant_type=password', { email, password, gotrue_meta_security: { captcha_token } });
  }

  async function signOut() {
    const session = await getSession();
    await store.remove('michel:session');
    if (!session) return;
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    await fetch(`${supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }

  // Envoie l'historique à la fonction « chat » et transmet la réponse au fil de l'eau.
  // Renvoie le prénom si la personne vient de le donner à Michel.
  async function ask(messages, name, onText, signal) {
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    const token = await getAccessToken();
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort());
    let silence;
    const alive = () => {
      clearTimeout(silence);
      silence = setTimeout(() => controller.abort(), SILENCE_MS);
    };
    alive();
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content })),
          name,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        if (res.status === 401) await store.remove('michel:session');
        throw new Error(text || `Erreur ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let trailer = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        alive();
        const chunk = decoder.decode(value, { stream: true });
        if (trailer !== null) {
          trailer += chunk;
          continue;
        }
        const cut = chunk.indexOf(TRAILER);
        if (cut === -1) onText(chunk);
        else {
          if (cut > 0) onText(chunk.slice(0, cut));
          trailer = chunk.slice(cut + 1);
        }
      }
      try {
        const info = trailer ? JSON.parse(trailer) : {};
        return typeof info.prenom === 'string' ? { name: info.prenom } : {};
      } catch {
        return {};
      }
    } catch (e) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('Michel s’est endormi sur sa chaise. Réessaie, con.');
      throw e;
    } finally {
      clearTimeout(silence);
    }
  }

  return {
    SITE,
    store,
    getConfig,
    getSession,
    signIn,
    signOut,
    ask,
    setCaptchaProvider: (fn) => (captchaProvider = fn),
  };
})();

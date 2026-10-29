import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PAGE_SIZE,
  deleteUser,
  exportMembers,
  listBroadcasts,
  listUsers,
  loadCosts,
  loadStats,
  mergeUsers,
  resumeBroadcast,
  sendBroadcast,
  testLettre,
  userUsage,
  type AdminUser,
  type Broadcast,
  type Costs,
  type Stats,
  type UserDay,
  type UserOrder,
} from './admin';
import { SWITCH_COLORS, colors, serif } from './theme';

type Tab = 'stats' | 'members' | 'message';

const TABS: { id: Tab; label: string }[] = [
  { id: 'stats', label: 'Tableau de bord' },
  { id: 'members', label: 'Membres' },
  { id: 'message', label: 'Annonce' },
];

const number = (n: number | null | undefined) => (n ?? 0).toLocaleString('fr-FR');
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
const shortDay = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
// Coût Claude en dollars : quatre décimales sous le dollar, les montants sont minuscules.
const dollars = (n: number | null | undefined) => {
  const value = Number(n ?? 0);
  const digits = value < 1 ? 4 : 2;
  return value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' $';
};
const contactOf = (u: AdminUser) =>
  u.email || (u.phone ? `+${u.phone.replace(/^\+/, '')}` : u.is_anonymous ? 'Visiteur anonyme' : '—');

// Back-office de MichelIA, ouvert depuis « Mon compte » pour les administrateurs.
export function AdminScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.barInner}>
          <Text style={styles.title}>Back-office</Text>
          <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.close}>Fermer</Text>
          </Pressable>
        </View>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, tab === t.id && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.id }}
            >
              <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === 'stats' && <StatsTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'message' && <MessageTab />}
    </View>
  );
}

function StatsTab() {
  const [stats, setStats] = useState<Stats>();
  const [costs, setCosts] = useState<Costs>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadStats()
      .then(setStats)
      .catch((e) => setError(e.message));
    // Absent tant que le SQL des coûts n'est pas lancé : le reste du tableau de bord s'affiche quand même.
    loadCosts()
      .then(setCosts)
      .catch(() => undefined);
  }, []);

  if (error) return <Text style={[styles.error, styles.padded]}>{error}</Text>;
  if (!stats) return <ActivityIndicator style={styles.padded} color={colors.accent} />;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.tiles}>
        <Tile label="Membres" value={stats.members} hint={`+${number(stats.members_7d)} en 7 j · +${number(stats.members_30d)} en 30 j`} />
        <Tile label="Visiteurs sans compte" value={stats.guests} />
        <Tile label="Questions aujourd'hui" value={stats.messages_today} hint={`${number(stats.messages_7d)} en 7 j · ${number(stats.messages_30d)} en 30 j`} />
        <Tile label="Actifs aujourd'hui" value={stats.active_today} hint={`${number(stats.active_7d)} en 7 j, dont ${number(stats.active_members_7d)} membres`} />
        <Tile label="Acceptent les nouvelles" value={stats.news_opt_in} hint={`${number(stats.audience_news)} joignables par e-mail`} />
        <Tile
          label="Appareils notifiables"
          value={stats.push_devices}
          hint={stats.push_devices === null ? 'Notifications pas encore branchées' : undefined}
        />
        <Tile label="Réponses en cache" value={stats.cache_answers} hint={`${number(stats.cache_hits)} fois resservies`} />
        {costs && (
          <Tile
            label="Coût Claude aujourd'hui"
            text={dollars(costs.cost_today)}
            hint={`${dollars(costs.cost_7d)} en 7 j · ${dollars(costs.cost_30d)} en 30 j`}
          />
        )}
      </View>

      <Section title="Questions par jour (30 jours)">
        <Bars days={stats.days} value={(d) => d.messages} />
      </Section>
      <Section title="Visiteurs actifs par jour">
        <Bars days={stats.days} value={(d) => d.active} />
      </Section>
      <Section title="Inscriptions par jour">
        <Bars days={stats.days} value={(d) => d.signups} />
      </Section>
      {costs && (
        <Section title="Coût Claude par jour (indicatif)">
          <Bars days={costs.days} value={(d) => d.cost} format={dollars} />
          <Text style={styles.small}>
            Estimation d'après les jetons de chaque réponse et les prix réglés dans app_config
            {costs.since ? `, mesurée depuis le ${date(costs.since)}` : ', pas encore de réponse mesurée'}. La facture qui fait foi
            reste celle de la console Claude.
          </Text>
        </Section>
      )}

      <Section title="Moyens de connexion">
        <Breakdown values={stats.providers} labels={{ email: 'E-mail', phone: 'SMS', google: 'Google', facebook: 'Facebook', apple: 'Apple' }} />
      </Section>
      <Section title="Âge des membres">
        <Breakdown values={stats.ages} order={['18-24', '25-34', '35-49', '50-64', '65+', 'inconnu']} />
      </Section>
      <Text style={styles.footnote}>
        Les compteurs de questions sont effacés après 90 jours (durée annoncée dans la politique de confidentialité).
      </Text>
    </ScrollView>
  );
}

function Tile({ label, value, text, hint }: { label: string; value?: number | null; text?: string; hint?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{text ?? (value === null || value === undefined ? '—' : number(value))}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// Histogramme simple en barres verticales, sans bibliothèque de graphiques.
function Bars<T extends { day: string }>({
  days,
  value,
  format = number,
}: {
  days: T[];
  value: (d: T) => number;
  format?: (n: number) => string;
}) {
  const max = Math.max(0, ...days.map(value));
  const total = days.reduce((sum, d) => sum + value(d), 0);
  return (
    <View>
      <View style={styles.bars}>
        {days.map((d) => (
          <View key={d.day} style={styles.barSlot} accessibilityLabel={`${shortDay(d.day)} : ${format(value(d))}`}>
            <View style={[styles.barFill, { height: `${max ? (value(d) / max) * 100 : 0}%` }]} />
          </View>
        ))}
      </View>
      <View style={styles.barLegend}>
        <Text style={styles.small}>{days.length ? shortDay(days[0].day) : ''}</Text>
        <Text style={styles.small}>
          max {format(max)} · total {format(total)}
        </Text>
        <Text style={styles.small}>{days.length ? shortDay(days[days.length - 1].day) : ''}</Text>
      </View>
    </View>
  );
}

function Breakdown({ values, labels = {}, order }: { values: Record<string, number>; labels?: Record<string, string>; order?: string[] }) {
  const keys = (order ?? Object.keys(values).sort((a, b) => values[b] - values[a])).filter((k) => values[k]);
  const max = Math.max(1, ...keys.map((k) => values[k]));
  if (!keys.length) return <Text style={styles.small}>Rien pour l'instant.</Text>;
  return (
    <View style={styles.breakdown}>
      {keys.map((k) => (
        <View key={k} style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{labels[k] ?? k}</Text>
          <View style={styles.breakdownTrack}>
            <View style={[styles.breakdownFill, { width: `${(values[k] / max) * 100}%` }]} />
          </View>
          <Text style={styles.breakdownValue}>{number(values[k])}</Text>
        </View>
      ))}
    </View>
  );
}

const ORDERS: { id: UserOrder; label: string }[] = [
  { id: 'recent', label: 'Récents' },
  { id: 'usage', label: 'Plus actifs' },
  { id: 'active', label: 'Vus récemment' },
  { id: 'cost', label: 'Plus coûteux' },
];

function MembersTab() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [membersOnly, setMembersOnly] = useState(true);
  const [order, setOrder] = useState<UserOrder>('recent');
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>();
  const [open, setOpen] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setUsers(undefined);
    setError(undefined);
    listUsers({ search: query, membersOnly, order, page })
      .then(setUsers)
      .catch((e) => setError(e.message));
  }, [query, membersOnly, order, page, reload]);

  // Après une suppression ou une liaison : message, fiche refermée, liste rechargée.
  function changed(message: string) {
    setNotice(message);
    setOpen(undefined);
    setReload((n) => n + 1);
  }

  const total = users?.[0]?.total_count ?? 0;

  async function runExport() {
    setExporting(true);
    setError(undefined);
    try {
      const rows = await exportMembers();
      setNotice(`${number(rows)} membres exportés. L'export est noté dans le journal du back-office.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'export a planté.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => {
            setPage(0);
            setQuery(search);
          }}
          placeholder="Chercher un e-mail, un numéro, un nom… (Entrée)"
          placeholderTextColor={colors.tertiary}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <View style={styles.filters}>
        {ORDERS.map((o) => (
          <Chip
            key={o.id}
            label={o.label}
            active={order === o.id}
            onPress={() => {
              setPage(0);
              setOrder(o.id);
            }}
          />
        ))}
        <Chip
          label="Avec les anonymes"
          active={!membersOnly}
          onPress={() => {
            setPage(0);
            setMembersOnly(!membersOnly);
          }}
        />
      </View>

      <View style={styles.row}>
        <Text style={styles.small}>{users ? `${number(total)} comptes` : ' '}</Text>
        <Pressable onPress={runExport} disabled={exporting} style={({ pressed }) => [styles.secondary, (pressed || exporting) && styles.pressed]}>
          <Text style={styles.secondaryText}>{exporting ? 'Export…' : 'Exporter les membres (CSV)'}</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      {!users && !error && <ActivityIndicator color={colors.accent} />}
      {users?.length === 0 && <Text style={styles.small}>Personne ne correspond.</Text>}
      {users && users.length > 0 && (
        <View style={styles.card}>
          {users.map((u, i) => (
            <MemberRow
              key={u.id}
              user={u}
              last={i === users.length - 1}
              open={open === u.id}
              onPress={() => setOpen(open === u.id ? undefined : u.id)}
              onChanged={changed}
            />
          ))}
        </View>
      )}

      {total > PAGE_SIZE && (
        <View style={styles.row}>
          <Chip label="← Précédents" active={false} disabled={page === 0} onPress={() => setPage(page - 1)} />
          <Text style={styles.small}>
            Page {page + 1} / {Math.ceil(total / PAGE_SIZE)}
          </Text>
          <Chip label="Suivants →" active={false} disabled={(page + 1) * PAGE_SIZE >= total} onPress={() => setPage(page + 1)} />
        </View>
      )}
    </ScrollView>
  );
}

function MemberRow({
  user,
  last,
  open,
  onPress,
  onChanged,
}: {
  user: AdminUser;
  last: boolean;
  open: boolean;
  onPress: () => void;
  onChanged: (message: string) => void;
}) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const contact = contactOf(user);
  return (
    <View style={[styles.member, !last && styles.memberBorder]}>
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.memberHead, pressed && styles.pressed]}>
        <View style={styles.memberMain}>
          <Text style={styles.memberName} numberOfLines={1}>
            {name || contact}
          </Text>
          {name ? (
            <Text style={styles.small} numberOfLines={1}>
              {contact}
            </Text>
          ) : null}
        </View>
        <View style={styles.memberUsage}>
          <Text style={styles.memberCount}>{number(user.messages_7d)}</Text>
          <Text style={styles.small}>questions / 7 j</Text>
          {user.cost_90d > 0 && <Text style={styles.small}>{dollars(user.cost_90d)} / 90 j</Text>}
        </View>
      </Pressable>
      {open && <MemberDetail user={user} onChanged={onChanged} />}
    </View>
  );
}

function MemberDetail({ user, onChanged }: { user: AdminUser; onChanged: (message: string) => void }) {
  const [days, setDays] = useState<UserDay[]>();

  useEffect(() => {
    userUsage(user.id)
      .then((rows) => {
        // Trente derniers jours, jours sans question compris.
        const byDay = new Map(rows.map((r) => [r.day, r]));
        const list = Array.from({ length: 30 }, (_, i) => {
          const d = new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
          return { day: d, messages: byDay.get(d)?.messages ?? 0, cost: Number(byDay.get(d)?.cost ?? 0) };
        });
        setDays(list);
      })
      .catch(() => setDays([]));
  }, [user.id]);

  const age = user.birth_year ? `${new Date().getFullYear() - user.birth_year} ans` : '—';
  const facts: [string, string][] = [
    ['Inscription', date(user.created_at)],
    ['Dernière connexion', date(user.last_sign_in_at)],
    ['Dernier jour actif', date(user.last_active)],
    ['Connexions', user.providers ?? '—'],
    ['Âge', age],
    ['Nouvelles', user.news_opt_in ? 'acceptées' : 'non'],
    ["Questions aujourd'hui", number(user.messages_today)],
    ['Questions sur 90 j', number(user.messages_90d)],
    ['Messages dans sa conversation', number(user.conversation_messages)],
    ['Coût Claude sur 7 j', dollars(user.cost_7d)],
    ['Coût Claude sur 90 j', dollars(user.cost_90d)],
    ['Identifiant', user.id],
  ];
  return (
    <View style={styles.detail}>
      {facts.map(([label, value]) => (
        <View key={label} style={styles.fact}>
          <Text style={styles.factLabel}>{label}</Text>
          <Text style={styles.factValue} selectable>
            {value}
          </Text>
        </View>
      ))}
      <Text style={[styles.factLabel, styles.detailChart]}>Questions par jour (30 jours)</Text>
      {days ? <Bars days={days} value={(d) => d.messages} /> : <ActivityIndicator color={colors.accent} />}
      {days && days.some((d) => d.cost > 0) && (
        <>
          <Text style={[styles.factLabel, styles.detailChart]}>Coût Claude par jour (indicatif)</Text>
          <Bars days={days} value={(d) => d.cost} format={dollars} />
        </>
      )}
      <AccountActions user={user} onChanged={onChanged} />
    </View>
  );
}

// Relier un autre compte de la même personne à celui-ci, ou supprimer ce compte.
function AccountActions({ user, onChanged }: { user: AdminUser; onChanged: (message: string) => void }) {
  const [mode, setMode] = useState<'link' | 'delete'>();
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<AdminUser[]>();
  const [other, setOther] = useState<AdminUser>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function reset(next?: 'link' | 'delete') {
    setMode(next);
    setSearch('');
    setFound(undefined);
    setOther(undefined);
    setError(undefined);
  }

  async function find() {
    if (!search.trim()) return;
    setError(undefined);
    setOther(undefined);
    try {
      const rows = await listUsers({ search, membersOnly: false, order: 'recent', page: 0 });
      setFound(rows.filter((u) => u.id !== user.id).slice(0, 5));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La recherche a planté.');
    }
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(undefined);
    try {
      onChanged(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ça a planté.');
      setBusy(false);
    }
  }

  const link = () =>
    run(async () => {
      const result = await mergeUsers(user.id, other!.id);
      const moved = [result.email_moved && "l'e-mail", result.phone_moved && 'le numéro'].filter(Boolean).join(' et ');
      return `Comptes reliés : ${contactOf(user)} se connecte maintenant avec ${result.providers.join(', ') || 'aucun moyen de connexion'}${
        moved ? ` (${moved} de l'autre compte récupéré${result.email_moved && result.phone_moved ? 's' : ''})` : ''
      }.`;
    });

  const remove = () =>
    run(async () => {
      await deleteUser(user.id);
      return `Compte ${contactOf(user)} supprimé, avec son usage et sa conversation.`;
    });

  if (!mode) {
    return (
      <View style={[styles.row, styles.detailChart]}>
        <Pressable onPress={() => reset('link')} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={styles.secondaryText}>Relier un autre compte…</Text>
        </Pressable>
        <Pressable onPress={() => reset('delete')} style={({ pressed }) => [styles.secondary, styles.dangerOutline, pressed && styles.pressed]}>
          <Text style={[styles.secondaryText, styles.dangerText]}>Supprimer le compte…</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'delete') {
    return (
      <View style={[styles.actions, styles.detailChart]}>
        <Text style={styles.switchLabel}>Supprimer {contactOf(user)} ?</Text>
        <Text style={styles.small}>
          Le compte, son profil, son usage, sa conversation et ses appareils sont effacés pour de bon. La personne pourra se
          réinscrire. La suppression est notée dans le journal du back-office.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <Chip label="Annuler" active={false} onPress={() => reset()} />
          <Pressable onPress={remove} disabled={busy} style={({ pressed }) => [styles.danger, (pressed || busy) && styles.pressed]}>
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>Supprimer pour de bon</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.actions, styles.detailChart]}>
      <Text style={styles.switchLabel}>Relier un autre compte à {contactOf(user)}</Text>
      <Text style={styles.small}>
        Pour une même personne inscrite deux fois (par exemple Facebook et Google). Ce compte-ci est gardé : il récupère les
        connexions Google, Facebook et Apple de l'autre, son usage, ses appareils et la conversation la plus récente. L'autre
        compte disparaît. Son e-mail et son numéro ne suivent que si ce compte-ci n'en a pas.
      </Text>
      <View style={styles.card}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={find}
          placeholder="E-mail, numéro ou nom de l'autre compte (Entrée)"
          placeholderTextColor={colors.tertiary}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      {found?.length === 0 && <Text style={styles.small}>Aucun autre compte ne correspond.</Text>}
      {found && found.length > 0 && !other && (
        <View style={styles.card}>
          {found.map((u) => (
            <Pressable key={u.id} onPress={() => setOther(u)} style={({ pressed }) => [styles.pick, pressed && styles.pressed]}>
              <Text style={styles.memberName} numberOfLines={1}>
                {contactOf(u)}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {[u.first_name, u.last_name].filter(Boolean).join(' ') || 'Sans nom'} · {u.providers ?? 'anonyme'} · inscrit le{' '}
                {date(u.created_at)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {other && (
        <Text style={styles.small}>
          On garde <Text style={styles.strong}>{contactOf(user)}</Text> ({user.providers ?? 'anonyme'}) et on y relie{' '}
          <Text style={styles.strong}>{contactOf(other)}</Text> ({other.providers ?? 'anonyme'}), qui disparaît.
          {user.email && other.email ? ` L'adresse ${other.email} ne servira plus à se connecter.` : ''}
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.row}>
        <Chip label="Annuler" active={false} onPress={() => reset()} />
        {other && (
          <Pressable onPress={link} disabled={busy} style={({ pressed }) => [styles.danger, (pressed || busy) && styles.pressed]}>
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>Relier les deux comptes</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, (pressed || disabled) && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const STATUS: Record<string, string> = {
  envoi: 'en cours',
  envoye: 'envoyé',
  partiel: 'en partie',
  echec: 'échec',
  en_attente: 'en attente',
  en_cours: 'en cours',
};

function MessageTab() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'news' | 'service'>('news');
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState(false);
  const [stats, setStats] = useState<Stats>();
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(() => {
    listBroadcasts().then(setHistory).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadStats().then(setStats).catch(() => undefined);
    refresh();
  }, [refresh]);

  // Les envois partent en tâche de fond : on rafraîchit l'historique tant qu'un envoi tourne.
  const running = history.some((b) => b.email_status === 'envoi' || b.push_status === 'en_attente' || b.push_status === 'en_cours');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const channels = [...(email ? ['email' as const] : []), ...(push ? ['push' as const] : [])];
  const reach = audience === 'news' ? stats?.audience_news : stats?.audience_service;

  async function run(test: boolean) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await sendBroadcast({ subject, body, audience, channels: test ? ['email'] : channels, test });
      if (test) {
        setNotice(`Test envoyé à ${result.email}.`);
      } else {
        setNotice(
          [
            email ? `${number(result.emails)} e-mails en cours d'envoi` : null,
            push ? 'notifications transmises à la fonction push' : null,
          ]
            .filter(Boolean)
            .join(', ') + '.',
        );
        setSubject('');
        setBody('');
        setConfirming(false);
        refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'envoi a planté.");
    } finally {
      setBusy(false);
    }
  }

  async function lettreTest() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await testLettre();
      setNotice(
        result.entrees
          ? `Lettre de test envoyée à ${result.email} (${number(result.entrees)} nouveautés).`
          : 'Rien de neuf depuis la dernière lettre : la prochaine ne partirait pas.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Le test de la lettre a planté.');
    } finally {
      setBusy(false);
    }
  }

  async function resume(id: number) {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await resumeBroadcast(id);
      setNotice(`Envoi repris pour ${number(result.emails)} destinataires (ceux déjà servis sont sautés).`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La reprise a planté.');
    }
  }

  const ready = subject.trim().length > 0 && body.trim().length > 0 && channels.length > 0;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Section title="Public">
        <Option
          selected={audience === 'news'}
          onPress={() => setAudience('news')}
          title="Nouvelles"
          text={`Membres qui ont accepté les nouvelles de Michel (${number(stats?.audience_news)} par e-mail). Un lien de désabonnement est ajouté.`}
        />
        <Option
          selected={audience === 'service'}
          onPress={() => setAudience('service')}
          title="Information de service"
          text={`Tous les membres (${number(stats?.audience_service)} par e-mail). Seulement pour le service lui-même : conditions, panne, fermeture. Jamais de promotion.`}
        />
      </Section>

      <Section title="Canaux">
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>E-mail</Text>
          <Switch value={email} onValueChange={setEmail} {...SWITCH_COLORS} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Notification (appli et web)</Text>
          <Switch value={push} onValueChange={setPush} {...SWITCH_COLORS} />
        </View>
        {push && stats?.push_devices === null && (
          <Text style={styles.small}>Les notifications ne sont pas encore branchées : l'annonce restera en attente jusque-là.</Text>
        )}
      </Section>

      <Section title="Message">
        <TextInput
          style={styles.subject}
          value={subject}
          onChangeText={setSubject}
          placeholder="Titre (objet de l'e-mail, titre de la notification)"
          placeholderTextColor={colors.tertiary}
          maxLength={150}
        />
        <TextInput
          style={styles.body}
          value={body}
          onChangeText={setBody}
          placeholder={'Adishatz {prenom} !\n\nTexte de l\'annonce. Une ligne vide sépare les paragraphes.'}
          placeholderTextColor={colors.tertiary}
          multiline
          maxLength={10000}
          textAlignVertical="top"
        />
        <Text style={styles.small}>
          {'{prenom}'} est remplacé par le prénom du membre. La notification reprend le titre et le début du texte.
        </Text>
      </Section>

      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.row}>
        <Pressable
          onPress={() => run(true)}
          disabled={busy || !subject.trim() || !body.trim()}
          style={({ pressed }) => [styles.secondary, (pressed || busy || !subject.trim() || !body.trim()) && styles.pressed]}
        >
          <Text style={styles.secondaryText}>M'envoyer un test</Text>
        </Pressable>
        {confirming ? (
          <Pressable onPress={() => run(false)} disabled={busy || !ready} style={({ pressed }) => [styles.danger, (pressed || busy) && styles.pressed]}>
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryText}>Confirmer l'envoi{email ? ` à ${number(reach)}` : ''}</Text>
            )}
          </Pressable>
        ) : (
          <Pressable onPress={() => setConfirming(true)} disabled={!ready} style={({ pressed }) => [styles.primary, (pressed || !ready) && styles.pressed]}>
            <Text style={styles.primaryText}>Envoyer…</Text>
          </Pressable>
        )}
      </View>

      <Section title="Lettre de Michel">
        <Text style={styles.small}>
          Part toute seule le matin, tous les 15 jours au plus, aux membres qui acceptent les nouvelles, avec les nouveautés du
          carnet pas encore racontées. Rien de neuf, pas de lettre.
        </Text>
        <Pressable onPress={lettreTest} disabled={busy} style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}>
          <Text style={styles.secondaryText}>M'envoyer la prochaine lettre</Text>
        </Pressable>
      </Section>

      <Section title="Dernières annonces">
        {history.length === 0 && <Text style={styles.small}>Aucune annonce pour l'instant.</Text>}
        {history.map((b) => (
          <View key={b.id} style={styles.history}>
            <Text style={styles.memberName} numberOfLines={1}>
              {b.subject}
            </Text>
            <Text style={styles.small}>
              {new Date(b.created_at).toLocaleString('fr-FR')} · {b.audience === 'news' ? 'nouvelles' : 'service'}
              {b.channels.includes('email') &&
                ` · e-mail ${STATUS[b.email_status ?? ''] ?? b.email_status ?? ''} ${number(b.email_sent)}/${number(b.email_total)}` +
                  (b.email_failed ? ` (${number(b.email_failed)} échecs)` : '')}
              {b.channels.includes('push') && ` · notification ${STATUS[b.push_status ?? ''] ?? b.push_status ?? ''}` + (b.push_sent ? ` (${number(b.push_sent)})` : '')}
            </Text>
            {interrupted(b) && <Text style={styles.resume} onPress={() => resume(b.id)} accessibilityRole="button">Reprendre l'envoi des e-mails</Text>}
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

// Envoi en échec, partiel, ou « en cours » depuis plus longtemps qu'une fonction ne peut tourner.
const interrupted = (b: Broadcast) =>
  b.channels.includes('email') &&
  (b.email_status === 'partiel' ||
    b.email_status === 'echec' ||
    (b.email_status === 'envoi' && !!b.email_started_at && Date.now() - Date.parse(b.email_started_at) > 7 * 60000));

function Option({ selected, onPress, title, text }: { selected: boolean; onPress: () => void; title: string; text: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, pressed && styles.pressed]} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={styles.optionText}>
        <Text style={styles.switchLabel}>{title}</Text>
        <Text style={styles.small}>{text}</Text>
      </View>
    </Pressable>
  );
}

const COLUMN = { width: '100%', maxWidth: 820, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 20 },
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.bar,
    paddingTop: Platform.OS === 'ios' ? 48 : 0,
  },
  barInner: {
    ...COLUMN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 56,
  },
  title: { color: colors.text, fontSize: 20, fontFamily: serif, fontWeight: '700' },
  close: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  tabs: { ...COLUMN, flexDirection: 'row', paddingHorizontal: 12, gap: 4 },
  tab: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.secondary, fontSize: 15, fontWeight: '600' },
  tabTextActive: { color: colors.accent },
  content: { ...COLUMN, padding: 16, paddingBottom: 48, gap: 14 },
  padded: { margin: 24 },
  pressed: { opacity: 0.6 },
  error: { color: colors.failed, fontSize: 14, textAlign: 'center' },
  notice: { color: colors.online, fontSize: 14, textAlign: 'center' },
  small: { color: colors.secondary, fontSize: 12, lineHeight: 17 },
  footnote: { color: colors.tertiary, fontSize: 12, textAlign: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: 160,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  tileValue: { color: colors.text, fontSize: 26, fontFamily: serif, fontWeight: '700' },
  tileLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  tileHint: { color: colors.secondary, fontSize: 12, marginTop: 4 },
  section: { gap: 6 },
  sectionTitle: { color: colors.secondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    boxShadow: '0 1px 2px rgba(60, 40, 20, 0.08)',
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  barFill: { backgroundColor: colors.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2, minHeight: 1 },
  barLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  breakdown: { gap: 8 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  breakdownLabel: { width: 80, color: colors.text, fontSize: 14 },
  breakdownTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  breakdownFill: { height: '100%', backgroundColor: colors.ochre },
  breakdownValue: { width: 56, textAlign: 'right', color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  search: { color: colors.text, fontSize: 16, paddingVertical: 2 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextActive: { color: colors.onAccent, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  member: { paddingVertical: 4 },
  memberBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, paddingBottom: 10 },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberMain: { flex: 1 },
  memberName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  memberUsage: { alignItems: 'flex-end' },
  memberCount: { color: colors.accent, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detail: { marginTop: 10, gap: 4, backgroundColor: colors.background, borderRadius: 10, padding: 12 },
  detailChart: { marginTop: 8, marginBottom: 4 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factLabel: { color: colors.secondary, fontSize: 13 },
  factValue: { color: colors.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  option: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  optionText: { flex: 1, gap: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.tertiary, marginTop: 2 },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  subject: {
    color: colors.text,
    fontSize: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    paddingVertical: 6,
  },
  body: { color: colors.text, fontSize: 15, minHeight: 180, lineHeight: 21 },
  secondary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  secondaryText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  primary: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: colors.accent, minWidth: 140, alignItems: 'center' },
  danger: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: colors.failed, minWidth: 180, alignItems: 'center' },
  primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  history: { gap: 2, paddingVertical: 4 },
  resume: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 2 },
  actions: { gap: 8 },
  pick: { gap: 2, paddingVertical: 4 },
  strong: { color: colors.text, fontWeight: '600' },
  dangerOutline: { borderColor: colors.failed },
  dangerText: { color: colors.failed },
});

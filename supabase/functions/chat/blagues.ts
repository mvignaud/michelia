// Tirage des blagues de Michel. Le répertoire vit dans le prompt (app_config), jamais dans le dépôt :
// on le relit dans la section « ## Tes blagues de comptoir ». Sans tirage, le modèle ressort toujours
// la première de la liste (le canard dans l'étang), à chaque conversation et en guise de chute.

const SECTION = "## Tes blagues de comptoir";
const REPERTOIRE = "Ton répertoire";
// Mots qui comptent pour reconnaître une blague déjà racontée (Michel la redit avec ses mots).
const MOT = /\p{L}{5,}/gu;

function normal(texte: string): string {
  return texte.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

// Les blagues courtes du répertoire : les lignes « - … » du paragraphe qui suit « Ton répertoire ».
// Les longues et l'humour noir, dans les paragraphes suivants, ne sont pas tirés au sort.
export function repertoire(prompt: string): string[] {
  const debut = prompt.indexOf(SECTION);
  if (debut === -1) return [];
  const fin = prompt.indexOf("\n## ", debut + SECTION.length);
  const section = prompt.slice(debut, fin === -1 ? undefined : fin);
  const liste = section.indexOf(REPERTOIRE);
  if (liste === -1) return [];
  const lignes = section.slice(liste).split("\n").slice(1);
  const blagues: string[] = [];
  for (const ligne of lignes) {
    if (!ligne.trim()) {
      if (blagues.length) break;
      continue;
    }
    if (ligne.startsWith("- ")) blagues.push(ligne.slice(2).trim());
  }
  return blagues;
}

// Déjà racontée si la plupart de ses mots marquants sont dans ce que Michel a déjà dit.
export function dejaRacontee(blague: string, dit: string): boolean {
  const mots = [...new Set(normal(blague).match(MOT) ?? [])];
  if (!mots.length) return false;
  const texte = normal(dit);
  return mots.filter((m) => texte.includes(m)).length / mots.length >= 0.6;
}

// Jusqu'à n blagues au hasard, en écartant celles déjà racontées dans la conversation.
export function tirer(blagues: string[], dit: string, n: number, hasard = Math.random): string[] {
  const neuves = blagues.filter((b) => !dejaRacontee(b, dit));
  const pot = neuves.length ? neuves : blagues;
  const copie = [...pot];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie.slice(0, n);
}

// Consigne ajoutée au contexte de chaque message. Demande de blague : trois tirées au sort, il en
// choisit une. Sinon : une seule, au cas où une blague viendrait naturellement en chute.
export function consigneBlagues(prompt: string, dit: string, demande: boolean, hasard = Math.random): string {
  const blagues = repertoire(prompt);
  if (!blagues.length) return "";
  const regle = "Ne ressers jamais une blague déjà racontée plus haut dans la conversation.";
  if (demande) {
    const choix = tirer(blagues, dit, 3, hasard);
    return "On te demande une blague. Pour varier, prends l'une de celles-ci, tirées au sort dans ton " +
      `répertoire (ou une de ton cru dans le même esprit) : ${choix.map((b) => `« ${b} »`).join(" ; ")}. ` +
      `Si on t'en réclame une longue ou une noire, pioche dans celles-là à la place. ${regle}`;
  }
  const [une] = tirer(blagues, dit, 1, hasard);
  return "Si une blague vient naturellement (rarement, et jamais sur un sujet sérieux), prends celle-ci, " +
    `pas une autre de la liste : « ${une} ». ${regle}`;
}

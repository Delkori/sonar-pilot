# Sonar Pilot

Cockpit de pilotage commercial pour le secteur **Auvergne-Rhône-Alpes**, construit à partir du PAS Q3 2026. Application indépendante (aucun lien technique avec Nexora), inspirée uniquement de son identité visuelle.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Supabase** (Postgres + Auth) — source de vérité
- **Tailwind CSS v4** — thème indigo/gris/Inter repris de Nexora
- **Vercel** — hébergement
- **GitHub** — code, branches, déploiements

## Principe d'architecture

```
Excel (PAS / KPI)  →  Import validé  →  Supabase (source de vérité)  →  Next.js  →  Vercel
```

- L'app ne lit **jamais** de fichier Excel en production. Excel n'est qu'un canal d'import.
- L'import est un **upsert** par `external_ref` (CODE SAP), jamais un delete+insert : un nouvel import ne fait jamais perdre les commentaires/actions déjà saisis dans l'app.
- Chaque import est journalisé dans la table `imports` (fichier, lignes réussies/en erreur, log détaillé) — jamais d'écrasement silencieux.
- La clé `SUPABASE_SERVICE_ROLE_KEY` n'est utilisée que côté serveur (route `/api/import`), jamais exposée au navigateur.

## Séparation dev / preview / production

Pour ne jamais qu'un test local touche les données réelles :

1. Créez **deux projets Supabase distincts** : `sonar-pilot-dev` et `sonar-pilot-prod`.
2. Sur Vercel, configurez les variables d'environnement **par environnement** (Development / Preview / Production) :
   - Development & Preview → projet Supabase `dev`
   - Production → projet Supabase `prod`
3. Ne travaillez jamais en local avec les clés de prod.

## Installation locale

```bash
npm install
cp .env.local.example .env.local
# renseigner NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

## Configuration Supabase

1. Créez un projet sur [supabase.com](https://supabase.com).
2. Appliquez la migration :
   ```bash
   npx supabase login
   npx supabase link --project-ref <votre-ref-projet>
   npx supabase db push
   ```
   ou collez le contenu de `supabase/migrations/0001_init.sql` dans le SQL Editor du dashboard Supabase.
3. Récupérez `Project URL`, `anon public key` et `service_role key` dans Project Settings → API, à mettre dans `.env.local` (et dans Vercel pour prod).
4. Activez l'authentification email (Auth → Providers) pour protéger l'accès à l'app — RLS est déjà activé sur toutes les tables et n'autorise que les utilisateurs authentifiés.

## Déploiement GitHub → Vercel

```bash
git init   # si pas déjà fait
git add .
git commit -m "Initial commit — Sonar Pilot"
gh repo create sonar-pilot --private --source=. --push
```

Puis sur [vercel.com](https://vercel.com) :
1. Importez le repo GitHub.
2. Renseignez les 3 variables d'environnement (voir ci-dessus) pour Production **et** Preview.
3. Déployez. Chaque push sur `main` déploie en Production, chaque PR obtient un environnement Preview isolé.

## Procédure d'import Excel

1. Aller dans **Paramètres › Import / Admin**.
2. Déposer le fichier **PAS Q3 2026 - RHONE ALPES.xlsx** (obligatoire — onglet `SUIVI COMPTES` lu automatiquement).
3. Déposer en complément le fichier **KPI RHONE ALPES ...xlsx** (optionnel — apporte ville, code postal, statut, commercial).
4. Lancer l'import : chaque ligne est validée avant écriture, les erreurs (CODE SAP manquant, doublon, segment invalide...) sont listées sans bloquer le reste de l'import.
5. Lancer le **géocodage** pour convertir ville + code postal en latitude/longitude (API Adresse du gouvernement français, gratuite) — nécessaire pour afficher les comptes sur la carte Mapping. Les coordonnées sont stockées en base, jamais recalculées à chaque affichage. Le traitement est borné en durée pour ne pas dépasser la limite de la plateforme : si la réponse indique des comptes restants, relancez-le.

## Mapping Excel → Supabase

| Fichier source | Onglet / feuille | Alimente |
|---|---|---|
| PAS Q3 2026 - RHONE ALPES.xlsx | `SUIVI COMPTES` | `accounts` (segment, CA historique, objectif/réalisé, score, action recommandée, commentaires → `account_actions`) |
| KPI RHONE ALPES ....xlsx | feuille unique | `accounts` (ville, code postal, statut, commercial, HCO type) |
| Calls By Customer.xlsx | `Export` | `accounts.last_call_date` / `days_since_last_call` (non branché par défaut — à activer si besoin) |
| Customer Growth By Brand...xlsx | `Export` | `account_products` (CA/quantités par marque) |

Si un champ manque pour une fonctionnalité demandée plus tard, ajoutez la colonne correspondante dans le PAS (préféré, cohérent avec le reste) ou une colonne dans Supabase — ne jamais inventer une donnée non présente dans la source.

## Structure du projet

```
app/(app)/            # Écrans applicatifs, tous sous le même layout (navigation latérale)
app/api/              # Routes serveur : import, géocodage, flux calendrier, sync personas
lib/data/queries.ts   # ← couche d'accès unique des pages serveur (voir ci-dessous)
lib/supabase/         # client.ts (navigateur) / server.ts (SSR) / admin.ts (service role)
lib/supabase/fetchAll.ts  # ← pagination obligatoire de toute lecture de liste
lib/import/           # parser.ts (lecture xlsx) / mapping.ts (colonnes → schéma) / validator.ts
lib/dates.ts          # libellés de mois + arithmétique de dates (source unique)
lib/stats.ts          # median / mean / sum
lib/geo.ts            # référentiel des départements du secteur
lib/ui-classes.ts     # classes partagées des champs de formulaire (sans dépendance)
components/layout/    # PageShell (gabarit de page), Sidebar, TopBar
components/ui/        # Card, Button, Field, Table, Badge, ScoreBadge, SortableTh
supabase/migrations/  # schéma SQL versionné
types/database.ts     # types TypeScript du schéma (`supabase gen types typescript`)
public/geo/           # GeoJSON des départements Auvergne-Rhône-Alpes (carte Mapping)
```

## Conventions à respecter

Ces quatre règles existent parce que leur absence a déjà produit des bugs
silencieux. Les enfreindre ne casse pas le build — ça fausse les chiffres.

### 1. Toute lecture de liste passe par `fetchAll`

Supabase plafonne chaque réponse à `max-rows` (**1000 lignes par défaut**)
et **ne le signale pas** : la requête réussit, il manque simplement des
lignes. Un `select()` nu sur `account_product_purchases` (une ligne par
compte × marque × facture) renvoyait ainsi un préfixe arbitraire de la
table, et tous les agrégats construits dessus — CA mensuel, vélocités,
RFM-S, prévisions, backtest — étaient calculés sur cet échantillon.

```ts
// ✗ tronqué en silence dès 1001 lignes
const { data } = await supabase.from("account_product_purchases").select("*");

// ✓
const rows = await fetchAll(() => supabase.from("account_product_purchases").select("*"));
```

`maybeSingle()`, `limit(n)` explicite et les `count` en `head: true` sont
évidemment exempts.

### 2. Les pages serveur lisent via `lib/data/queries.ts`

`getAccounts`, `getMonthlySales`, `getAccountProducts`, `getForecasts`,
`getPurchaseLines`, `getHcps`, `getSectorObjectives`… Chaque page écrivait
sa propre variante des mêmes requêtes, avec sa liste de colonnes et son
cast : une correction appliquée à un endroit ne l'était nulle part
ailleurs. Ajoutez une colonne dans le loader, pas dans la page.

Les lectures indépendantes se lancent en `Promise.all` — en série, une
page cumulait six allers-retours Supabase avant le premier octet.

### 3. Un écran = un `PageShell`

```tsx
<PageShell title="Comptes" subtitle="…" actions={<Button …/>}>
  …
</PageShell>
```

Gouttières, rythme vertical et barre de titre collante sont définis une
seule fois. `bare` pour les vues plein écran (calendrier, carte).

### 4. Pas de classes Tailwind recopiées

- Boutons → `<Button>` / `<SegmentedControl>` (`components/ui/Button`)
- Champs → `<Input>` / `<Select>` / `<Textarea>`, ou `fieldClass` quand il
  faut garder la balise native
- Tableaux → `<TableWrap>` (défilement horizontal) + `theadRowClass`
- Libellés de mois → `MONTHS_SHORT` / `MONTHS_LONG` / `MONTHS_INITIAL`
  (`lib/dates`), jamais un tableau local
- « jours depuis » → `daysSince` / `weeksSince` / `daysBetween`, jamais
  `/ 86400000` à la main
- Dates au format `YYYY-MM-DD` → `toDateStr`, **jamais**
  `toISOString().slice(0, 10)` : en heure d'été, minuit local tombe la
  veille en UTC (un lundi ressortait daté du dimanche)

## Tests

```bash
npm test
```

Les modules de calcul sont purs et sans dépendance : ce sont eux qui portent
les tests, parce qu'une régression y est invisible — elle ne lève aucune
erreur, elle renvoie juste un nombre différent.

- `lib/__tests__/` — dates (dont le décalage d'heure d'été), statistiques,
  cadence et statut des comptes, score de ciblage, flux `.ics`, jours ouvrés
- `lib/__tests__/forecast.test.ts` — fusion des trois signaux produit
  (rythme du compte / vélocité de marque / motif saisonnier), bornes du
  générateur, répartition par médecin
- `lib/__tests__/probability.test.ts` — probabilités de commande : étiquetage
  sans fuite du futur, niveaux de critères, ordre attendu entre profils,
  Brier et AUC face au taux de base, table de fiabilité, facteurs
- `lib/__tests__/forecast-topup.test.ts` — comblement de l'objectif secteur :
  plafond de potentiel, exclusion des comptes sans historique et des comptes
  perdus, plafond de concentration par client, unicité compte × mois
- `lib/sonarscore/__tests__/` — vélocités, prédiction par intervalle, motifs
  saisonniers
- `lib/supabase/__tests__/fetchAll.test.ts` — pagination : couvre
  explicitement le cas « plus de 1000 lignes »
- `lib/__tests__/schema.test.ts` — garde-fou de schéma : vérifie que toute
  table interrogée par le code est bien créée par une migration, que la
  numérotation des migrations est continue et que chacune active RLS

La suite est épinglée sur `TZ=Europe/Paris` (voir le script `test`) : c'est
le fuseau du secteur, et celui sous lequel les bugs de date se manifestent.
Sous un autre fuseau les tests passent toujours, mais certains vérifient
alors moins de choses.

## Vérifications avant de pousser

```bash
npm test
npm run lint       # doit être silencieux
npm run typecheck
npm run build
```

## Exercices : aucune année n'est écrite en dur

Le schéma porte une colonne par exercice (`ca_2022` … `ca_2026_ytd`). Lire
ces colonnes directement condamne l'écran concerné à devenir faux au
1ᵉʳ janvier suivant : le dashboard n'aurait plus proposé l'année en cours en
2027, et le score de ciblage aurait comparé 2024 à 2025 indéfiniment.

Tout passe donc par **`lib/revenue.ts`** :

- `revenueByAccountYear(ventes)` — CA par compte et par année, agrégé depuis
  `account_monthly_sales`, qui couvre n'importe quel exercice sans migration ;
- `revenueForYear(compte, année, map)` — la donnée mesurée d'abord, repli sur
  la colonne annuelle héritée pour les exercices antérieurs à l'historique
  mensuel importé (les CA repris de l'ancien PAS) ;
- `availableYears(...)` — les années réellement documentées, plus l'année en
  cours, qui doit rester sélectionnable dès le 1ᵉʳ janvier ;
- `referenceYears()` — le dernier exercice clos et le précédent, relatifs à
  la date du jour : c'est sur eux que raisonnent le score de ciblage et le
  prévisionnel.

Les colonnes annuelles ne sont plus qu'un repli, et un test
(`lib/__tests__/schema.test.ts`) échoue si un écran recommence à les lire
directement.

## Probabilités de commande

Onglet **Planning › Chances** : la chance que chaque compte commande
dans les 1, 3 ou 6 prochains mois, apprise sur l'historique réel du
portefeuille — pas un barème à poids fixes.

**Comment c'est appris.** Chaque (compte, mois passé) est une situation. On
observe l'état du compte à ce mois-là en n'utilisant que ce qui était connu
à l'époque, puis on regarde s'il a commandé dans les N mois suivants. Neuf
critères : cadence de commande, position dans le cycle (début, fin, due, en
retard, décroché), commandes sur 12 mois, tendance sur 6 mois,
saisonnalité (commandait-il aux mêmes mois l'an dernier), segment, tier,
référence attendue (d'après les vélocités produit) et **prévision saisie**
(vous aviez vous-même prévu une commande sur la période, dans Planning ›
Mois — seules les lignes manuelles comptent, et seulement si elles
existaient déjà au mois de référence, sinon le modèle tricherait). Le poids
de ce dernier critère est appris comme les autres : il mesure à quel point
vos prévisions se réalisent, et vaut zéro tant qu'il n'y a pas
d'historique de prévisions. Les critères sont
combinés par régression logistique régularisée — une combinaison naïve des
taux surcompte les critères corrélés (cadence, retard et activité disent en
partie la même chose) — puis recalibrés sur les mois les plus récents, tenus
à l'écart de l'apprentissage.

**Ce que la page montre.**
- comptes attendus en commande (somme des probabilités) et CA attendu
  (probabilité × commande type × commandes attendues sur l'horizon) ;
- **la probabilité selon chaque critère** : pour chaque niveau, la fréquence
  réelle de commande observée et le nombre de situations (`n`), face au taux
  de base ;
- la **fiabilité** : AUC, score de Brier contre le taux de base, et la table
  « annoncé / réellement commandé » par tranche de probabilité — quand le
  modèle dit 60 %, combien ont commandé ?
- le tableau des comptes, triable, avec les facteurs les plus favorable et
  défavorable de chacun.

La fiche compte affiche la probabilité à 3 mois avec ses neuf facteurs.
Le CA attendu est une espérance, pas une prévision ligne à ligne : la
planification reste dans Planning › Mois, qui réutilise le même modèle à
horizon 1 mois (voir plus bas). Module : `lib/probability.ts` — les poids
appris (`weights`, `platt`) sont sérialisables, `createFeatureContext` +
`probabilityForMonth` projettent un mois futur sans réapprendre. Tests
dans `lib/__tests__/probability.test.ts` (dont l'absence de fuite du futur,
la supériorité sur le taux de base et la projection avec commandes
anticipées).

### Mesurer le modèle sur les données réelles

```bash
npm run eval:probability -- --data <dossier>
```

Le dossier contient quatre exports JSON de Supabase (`accounts.json`,
`monthly_sales.json`, `purchases.json`, `forecasts.json` — colonnes
attendues en tête de `scripts/evaluate-probability.ts`). Le script ne
touche pas à la base. Il donne :

1. **l'évaluation interne**, celle qu'affiche l'onglet Chances (fenêtre
   des 6 derniers mois tenue à l'écart de l'apprentissage) ;
2. **un test en aveugle à origines glissantes** : le modèle est réappris
   à chaque mois T du passé avec les seules données connues à T, puis
   confronté aux commandes réellement passées dans (T, T+H]. Les chiffres
   sont donnés pour tous les comptes et pour les seuls comptes ayant déjà
   commandé — la question ne se pose vraiment que pour eux, et c'est là
   que le modèle est le plus dur à battre. Une règle naïve (part des 12
   derniers mois avec commande) sert de point de comparaison ;
3. les poids appris par niveau de critère ;
4. le taux de réalisation des lignes du prévisionnel (saisies / générées).

L'onglet Chances affiche la fiabilité mesurée **sur les comptes ayant déjà
commandé** (`evaluationClients`) dès que la fenêtre en compte au moins 30 :
l'évaluation globale, qui inclut les comptes sans aucune vente que le modèle
écarte sans mérite, flatte l'AUC (0,94 contre 0,8).

Mesuré le 12 septembre 2026 (550 comptes, 104 ayant commandé, ventes de
janvier 2024 à août 2026), en aveugle, sur les comptes ayant déjà
commandé : AUC 0,78 / 0,81 / 0,83 à 1 / 3 / 6 mois ; les 10 % de comptes
les mieux classés commandent à 50 % / 81 % / 88 % contre 14 % / 33 % / 48 %
au hasard ; gain de Brier sur le taux de base 21 % / 44 % / 58 %. À 3 mois
le modèle est bien calibré jusqu'à 70 % ; au-delà il surestime un peu
(annonce 75–86 %, observe 57–73 %). À 1 mois il ne fait pas mieux que la
règle naïve en score de Brier, seulement en classement. Le critère
« prévision saisie » n'a encore aucun poids : les prévisions manuelles
datent de juillet 2026, aucune n'est encore observable à l'apprentissage.

## Navigation : quatre entrées, sept onglets

Douze écrans ont été regroupés en quatre entrées ; les sous-écrans sont des
onglets, chacun restant une route à part entière (URL partageable, bouton
précédent, données chargées par onglet seulement). Le principe : une entrée
par geste de gestion du secteur, pas par famille de données. L'ancien hub
« Analyse » a été dissous — les chances de commande servent à planifier,
elles vivent dans Planning ; produits, personas et prospects servent à
préparer une visite, ils vivent dans Comptes.

| Entrée | Onglets | Anciennes adresses (redirigées) |
|---|---|---|
| Dashboard | — | |
| Planning | Mois · Semaine · Chances | `/pilotage`, `/relances`, `/probabilites`, `/analyse` |
| Comptes | Liste · Carte · Produits · Prospects (+ fiche `/comptes/[id]`) | `/mapping`, `/matrice`, `/personas`, `/sponsoring`, `/analyse/*` |
| Paramètres | Objectifs, personas, import (+ correspondances) | `/admin/*` |

- **Chances** (ex-Probabilités) : qui va commander dans les 1, 3 ou 6 mois,
  critère par critère, avec la fiabilité mesurée. Le SonarScore (bêta) n'est
  plus un onglet : c'est un outil avancé, accessible par un lien en bas de
  Chances (`/planning/chances/sonarscore`).
- **Produits** réunit la matrice produit (qui a acheté quoi, références vs
  N-1) et les personas (modèle d'achat par spécialité, références à proposer
  à chaque compte) : c'est la même question de préparation de visite.
- **Prospects** (ex-Concurrence) : les médecins sponsorisés de vos
  départements absents de votre Salesforce, et l'investissement des
  laboratoires sur le secteur.

**Recherche globale.** Le champ en tête de la barre latérale (raccourci
⌘K / Ctrl+K) cherche un compte par nom, code SAP ou ville et ouvre sa
fiche — ↑ ↓ pour choisir, Entrée pour ouvrir. C'est le geste le plus
fréquent de la journée ; il ne demandait auparavant pas moins de trois
écrans.

## Planning › Mois — mois affiché, chances de commande, rendez-vous

Le choix du mois est le premier réglage du tableau, avant l'horizon et le
tri. Le tableau part par défaut du mois en cours, sur l'horizon choisi
(1 / 3 / 6 / 12 / 24 mois). Le mois de départ se règle librement, y
compris sur un mois passé : c'est ainsi qu'on confronte le prévisionnel d'un
trimestre écoulé à son réalisé, mois par mois.

- flèches `‹` / `›` pour un mois, `− N mois` / `+ N mois` pour une période
  entière (comparer un trimestre au précédent) ;
- sélecteurs mois + année pour aller directement quelque part ;
- les bornes proposées vont de la plus ancienne donnée connue (vente réelle
  ou prévision saisie) à deux ans devant.

Chaque colonne indique si le mois est **en cours** ou **clos**. Sur une
période entièrement écoulée, « Générer le prévisionnel du portefeuille » est
désactivé : il y créerait des prévisions pour des mois déjà facturés. La
saisie reste possible (glisser une opportunité dans le mois, ou passer par la
fiche compte, qui accepte n'importe quel mois).

**Une prévision saisie nourrit le modèle.** Chaque carte d'un mois à venir
affiche la **chance de commande** du compte ce mois-là (modèle à 1 mois,
appris côté serveur sur tout le portefeuille). Les prévisions que vous
posez à la main (glisser-déposer, CA modifié, ligne déplacée — tout ce qui
est marqué `manuel`) sont prises en compte de deux façons :
- comme critère « vous l'aviez prévu » pour le mois concerné ;
- comme **commande anticipée** pour les mois qui suivent : une prévision
  posée en octobre remet le cycle du compte à zéro, et sa chance de
  commander en novembre en tient compte (un compte trimestriel retombe en
  « début de cycle »). Seules comptent les prévisions à partir du mois en
  cours ; une prévision passée non réalisée n'est pas une commande, et une
  ligne générée par le modèle ne se nourrit pas elle-même.
L'en-tête de chaque mois à venir donne le prévu **pondéré par les
chances** : la somme des CA prévus multipliés par la probabilité de chaque
compte — ce sur quoi on peut raisonnablement compter.

**Le générateur est branché sur le modèle.** « Générer le prévisionnel du
portefeuille » ne pose une ligne que si le modèle donne au compte au moins
la **chance minimale** choisie à côté du bouton (20 % par défaut, « sans
filtre » pour retrouver l'ancien comportement). Le générateur sait *quand*
un compte pourrait recommander (cadence, saisonnalité, achats produit) ; le
modèle sait *si* c'est plausible. Les lignes déjà posées sur les mois
d'avant comptent comme commandes anticipées quand on interroge le modèle
pour le mois suivant, et le comblement de l'objectif secteur préfère les
comptes les plus probables. La chance au moment de la génération est
inscrite dans la note de la ligne. Mesuré avant ce filtre sur juillet et
août 2026 : 81 lignes générées réalisées à 2,5 % ; les comptes à 30 % ou
plus selon le modèle commandaient à 25–27 %.

**Prévision sans rendez-vous.** Si aucune visite ni aucun appel n'est posé
dans Planning › Semaine pour ce compte ce mois-là, la carte le signale
(« Aucun rendez-vous ce mois-ci ») et l'en-tête du mois compte ces cartes.
La commande peut très bien se prendre autrement : on renseigne alors le
mode de contact — **Appel**, **Mail** ou **Visite à caler** — et l'alerte
s'éteint (colonne `contact_mode`, migration `0020`). Le lien calendrier
ouvre la semaine pour caler le rendez-vous. Rien n'est signalé sur un mois
clos ni sur une ligne déjà commandée. L'export Excel reprend la chance de
commande et l'état du rendez-vous.

## Comptes — filtres partagés entre les onglets

Les filtres de la liste (segment, statut, tier, récurrence, recherche)
vivent dans l'URL (`/comptes?segment=A&tier=Premium`) et suivent d'un
onglet à l'autre : la Carte et les Produits s'ouvrent sur le même segment
et la même recherche, et un lien vers `/comptes?tier=Pro` depuis le
Planning arrive directement filtré. Hook : `lib/hooks/useUrlFilter.ts`
(écrit l'URL sans rechargement) ; les onglets de hub reportent la chaîne de
requête.

## Fiche compte — mois par mois

Les trois lectures mensuelles du compte (prévisionnel, objectifs, réalisé)
tiennent dans une seule carte « Mois par mois », avec un sélecteur, au lieu
de trois cartes de douze lignes empilées qui faisaient défiler la fiche sur
trois écrans. Les trois panneaux restent montés : une saisie en cours ne
disparaît pas de l'écran quand on change de vue.

## Comptes › Carte

Carte choroplèthe SVG des 12 départements AURA (Ain, Allier, Ardèche, Cantal, Drôme, Isère, Loire, Haute-Loire, Puy-de-Dôme, Rhône, Savoie, Haute-Savoie), colorée selon l'écart objectif/réalisé, avec les comptes géocodés superposés en points cliquables (taille selon segment). Filtres segment/statut, clic sur un département pour isoler la zone, panneau latéral pour ouvrir la fiche compte.

## Points ouverts connus

- **`/api/cleanup-pas`** est une opération de maintenance ponctuelle qui
  efface cinq colonnes sur **tous** les comptes. Elle exige
  `{ "confirm": "cleanup-pas" }` dans le corps de la requête ; une fois le
  nettoyage fait une bonne fois, la route peut être supprimée.
- **Le filtre par chance de commande du générateur n'a pas encore été
  mesuré en conditions réelles** : il date de septembre 2026, les premières
  lignes générées avec lui arriveront à échéance en octobre. Rejouer
  `npm run eval:probability` après deux ou trois mois dira si le taux de
  réalisation des lignes générées a quitté les 2,5 % d'avant.
- **`lib/forecast.ts` (910 lignes) et `PilotageBoard.tsx` (1622 lignes)**
  restent les deux plus gros fichiers du projet. Le premier est maintenant
  couvert par des tests, donc découpable sans risque — par signal, plutôt
  que par ordre d'écriture. Le second gagnerait à être scindé par panneau.

## Prochaines évolutions envisagées (non codées)

- Territoires "gamifiés" avec objectifs par zone et jauge de progression (table `territory_objectives` déjà prête en base).
- Synchronisation automatique Google Sheets → Supabase (en remplacement de l'import manuel), une fois le mapping de colonnes stabilisé.
- Authentification multi-commerciaux avec rôles si le secteur est partagé.

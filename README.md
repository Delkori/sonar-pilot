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

1. Aller dans **Paramètres › Import / Admin** (dernière entrée de la navigation).
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

## Pilotage — période affichée

Le tableau des prévisions part par défaut du mois en cours, sur l'horizon
choisi (1 / 3 / 6 / 12 / 24 mois). Le mois de départ se règle librement, y
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

## Module Mapping

Carte choroplèthe SVG des 12 départements AURA (Ain, Allier, Ardèche, Cantal, Drôme, Isère, Loire, Haute-Loire, Puy-de-Dôme, Rhône, Savoie, Haute-Savoie), colorée selon l'écart objectif/réalisé, avec les comptes géocodés superposés en points cliquables (taille selon segment). Filtres segment/statut, clic sur un département pour isoler la zone, panneau latéral pour ouvrir la fiche compte.

## Points ouverts connus

- **`/api/cleanup-pas`** est une opération de maintenance ponctuelle qui
  efface cinq colonnes sur **tous** les comptes. Elle exige
  `{ "confirm": "cleanup-pas" }` dans le corps de la requête ; une fois le
  nettoyage fait une bonne fois, la route peut être supprimée.
- **`lib/forecast.ts` (910 lignes) et `PilotageBoard.tsx` (1263 lignes)**
  restent les deux plus gros fichiers du projet. Le premier est maintenant
  couvert par des tests, donc découpable sans risque — par signal, plutôt
  que par ordre d'écriture. Le second gagnerait à être scindé par panneau.

## Prochaines évolutions envisagées (non codées)

- Territoires "gamifiés" avec objectifs par zone et jauge de progression (table `territory_objectives` déjà prête en base).
- Synchronisation automatique Google Sheets → Supabase (en remplacement de l'import manuel), une fois le mapping de colonnes stabilisé.
- Authentification multi-commerciaux avec rôles si le secteur est partagé.

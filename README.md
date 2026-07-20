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

1. Aller dans **Import** (icône upload dans la sidebar).
2. Déposer le fichier **PAS Q3 2026 - RHONE ALPES.xlsx** (obligatoire — onglet `SUIVI COMPTES` lu automatiquement).
3. Déposer en complément le fichier **KPI RHONE ALPES ...xlsx** (optionnel — apporte ville, code postal, statut, commercial).
4. Lancer l'import : chaque ligne est validée avant écriture, les erreurs (CODE SAP manquant, doublon, segment invalide...) sont listées sans bloquer le reste de l'import.
5. Lancer le **géocodage** pour convertir ville + code postal en latitude/longitude (API Adresse du gouvernement français, gratuite) — nécessaire pour afficher les comptes sur la carte Mapping. Les coordonnées sont stockées en base, jamais recalculées à chaque affichage.

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
app/(app)/          # Dashboard, Comptes, Fiche compte, Mapping, Import — toutes protégées par le même layout (sidebar)
app/api/import/      # Route serveur : parse + valide + upsert Excel → Supabase
app/api/geocode/     # Route serveur : géocodage ville/CP → lat/lng
lib/import/          # parser.ts (lecture xlsx) / mapping.ts (colonnes → schéma) / validator.ts
lib/supabase/         # client.ts (navigateur) / server.ts (SSR) / admin.ts (service role, serveur uniquement)
supabase/migrations/  # schéma SQL versionné
types/database.ts     # types TypeScript du schéma (à régénérer avec `supabase gen types typescript` une fois le schéma appliqué)
public/geo/            # GeoJSON des 12 départements Auvergne-Rhône-Alpes (carte Mapping)
```

## Module Mapping

Carte choroplèthe SVG des 12 départements AURA (Ain, Allier, Ardèche, Cantal, Drôme, Isère, Loire, Haute-Loire, Puy-de-Dôme, Rhône, Savoie, Haute-Savoie), colorée selon l'écart objectif/réalisé, avec les comptes géocodés superposés en points cliquables (taille selon segment). Filtres segment/statut, clic sur un département pour isoler la zone, panneau latéral pour ouvrir la fiche compte.

## Prochaines évolutions envisagées (non codées)

- Territoires "gamifiés" avec objectifs par zone et jauge de progression (table `territory_objectives` déjà prête en base).
- Synchronisation automatique Google Sheets → Supabase (en remplacement de l'import manuel), une fois le mapping de colonnes stabilisé.
- Authentification multi-commerciaux avec rôles si le secteur est partagé.

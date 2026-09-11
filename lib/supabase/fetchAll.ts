/**
 * Récupère TOUTES les lignes d'une requête PostgREST, par pages.
 *
 * Pourquoi c'est indispensable ici : Supabase plafonne toute réponse à
 * `max-rows` (1000 par défaut) et ne signale rien — la requête réussit, il
 * manque juste des lignes. Or les pages Dashboard / Pilotage / SonarScore
 * lisaient `account_monthly_sales`, `account_products` et surtout
 * `account_product_purchases` (une ligne par compte × marque × facture,
 * plusieurs milliers) sans pagination : au-delà de 1000 lignes, tous les
 * agrégats (CA mensuel, vélocités, RFM-S, prévisions) étaient calculés sur
 * un échantillon arbitraire — le début de la table — sans le moindre
 * avertissement. Le symptôme est pernicieux : des chiffres plausibles mais
 * faux, et d'autant plus faux que la base grossit.
 *
 * Le tri explicite sur une clé stable évite qu'une même ligne apparaisse
 * dans deux pages (ou dans aucune) : sans `order`, Postgres ne garantit
 * aucun ordre entre deux requêtes `range` successives.
 */
const PAGE_SIZE = 1000;

// On ne dépend que de la surface réellement utilisée du builder PostgREST
// (`order` puis `range`, thenable) plutôt que de son type générique à six
// paramètres, dont la forme change d'une version de @supabase/postgrest-js
// à l'autre.
interface RangeableBuilder<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}
interface OrderableBuilder<T> {
  order(column: string, options: { ascending: boolean }): RangeableBuilder<T>;
}

export async function fetchAll<T>(
  build: () => OrderableBuilder<T>,
  options?: { orderBy?: string; ascending?: boolean; pageSize?: number }
): Promise<T[]> {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const orderBy = options?.orderBy ?? "id";
  const ascending = options?.ascending ?? true;

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build()
      .order(orderBy, { ascending })
      .range(from, from + pageSize - 1);

    if (error) {
      // Une page en erreur rendrait le reste incohérent : on remonte plutôt
      // que de renvoyer un jeu partiel qui se ferait passer pour complet.
      throw new Error(`fetchAll(${orderBy}) : ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

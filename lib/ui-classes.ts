/**
 * Classes partagées des contrôles de formulaire.
 *
 * Volontairement dans un module sans aucune dépendance : `components/ui/Field`
 * tire `clsx` + `tailwind-merge` (~9 ko), ce qui n'a pas à peser sur une page
 * qui veut seulement la chaîne de classes — la page de login, notamment.
 *
 * Le style était auparavant recopié dans 36 endroits avec sept variantes de
 * padding, et systématiquement en `outline-none` sans anneau de remplacement :
 * la navigation au clavier n'avait donc aucun indicateur visible.
 */
export const fieldClass =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary " +
  "focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

/** Variante confortable — formulaires isolés (connexion) plutôt que barres de filtres. */
export const fieldClassLg = fieldClass.replace("px-3 py-1.5", "w-full px-3 py-2");

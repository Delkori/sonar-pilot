import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Anciennes adresses. Douze écrans ont été regroupés en quatre entrées
   * (Planning et Comptes portent des onglets ; l'ancien hub Analyse s'y est
   * dissous) : les marque-pages et l'historique des navigateurs continuent
   * d'aboutir, sans chaîne de redirections.
   */
  async redirects() {
    return [
      { source: "/pilotage", destination: "/planning", permanent: true },
      { source: "/relances", destination: "/planning/semaine", permanent: true },
      { source: "/mapping", destination: "/comptes/carte", permanent: true },
      { source: "/matrice", destination: "/comptes/produits", permanent: true },
      { source: "/probabilites", destination: "/planning/chances", permanent: true },
      { source: "/analyse", destination: "/planning/chances", permanent: true },
      { source: "/sonarscore", destination: "/planning/chances/sonarscore", permanent: true },
      { source: "/analyse/sonarscore", destination: "/planning/chances/sonarscore", permanent: true },
      { source: "/personas", destination: "/comptes/produits", permanent: true },
      { source: "/analyse/personas", destination: "/comptes/produits", permanent: true },
      { source: "/sponsoring", destination: "/comptes/prospects", permanent: true },
      { source: "/analyse/concurrence", destination: "/comptes/prospects", permanent: true },
      { source: "/admin/import", destination: "/parametres", permanent: true },
      { source: "/admin/correspondances", destination: "/parametres/correspondances", permanent: true },
    ];
  },
};

export default nextConfig;

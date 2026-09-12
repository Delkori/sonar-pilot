import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Anciennes adresses. Douze écrans ont été regroupés en cinq entrées
   * (Planning, Comptes et Analyse portent des onglets) : les marque-pages et
   * l'historique des navigateurs continuent d'aboutir.
   */
  async redirects() {
    return [
      { source: "/pilotage", destination: "/planning", permanent: true },
      { source: "/relances", destination: "/planning/semaine", permanent: true },
      { source: "/mapping", destination: "/comptes/carte", permanent: true },
      { source: "/matrice", destination: "/comptes/produits", permanent: true },
      { source: "/probabilites", destination: "/analyse", permanent: true },
      { source: "/sonarscore", destination: "/analyse/sonarscore", permanent: true },
      { source: "/personas", destination: "/analyse/personas", permanent: true },
      { source: "/sponsoring", destination: "/analyse/concurrence", permanent: true },
      { source: "/admin/import", destination: "/parametres", permanent: true },
      { source: "/admin/correspondances", destination: "/parametres/correspondances", permanent: true },
    ];
  },
};

export default nextConfig;

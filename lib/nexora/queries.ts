import "server-only";
import { createNexoraClient } from "@/lib/supabase/nexora";

// Départements du secteur (AURA + Saône-et-Loire, Nièvre).
export const SECTEUR_DEPTS = [
  "01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74", "71", "58",
];
export const SECTEUR_REGION = "Auvergne-Rhône-Alpes";

export interface CompetitorAmount {
  nom_labo: string;
  montant: number;
  nb_medecins: number;
}
export interface NexoraProspect {
  rpps: string;
  nom: string;
  prenom: string | null;
  specialite: string | null;
  ville: string | null;
  dept: string | null;
  montant_percu: number | null;
  sponso: boolean;
  is_esth: boolean;
  is_derm: boolean;
  is_chir: boolean;
}
export interface SponsoringTotals {
  rpps: string;
  montant_total: number | null;
  montant_avantage: number | null;
  montant_remuneration: number | null;
  montant_convention: number | null;
  nb_laboratoires: number | null;
  nb_declarations: number | null;
}
export interface LabByRpps {
  rpps: string;
  nom_labo: string;
  montant: number;
}

export function nexoraConfigured(): boolean {
  return createNexoraClient() !== null;
}

export async function getCompetitorAmounts(region: string | null): Promise<CompetitorAmount[]> {
  const nexora = createNexoraClient();
  if (!nexora) return [];
  const { data, error } = await nexora.rpc("sonar_competitor_amounts", { p_region: region });
  if (error) {
    console.error("[nexora] sonar_competitor_amounts:", error.message);
    return [];
  }
  return (data ?? []) as CompetitorAmount[];
}

export async function getProspects(opts: {
  depts?: string[] | null;
  onlySponso?: boolean;
  onlyEsth?: boolean;
  limit?: number;
}): Promise<NexoraProspect[]> {
  const nexora = createNexoraClient();
  if (!nexora) return [];
  const { data, error } = await nexora.rpc("sonar_prospects", {
    p_depts: opts.depts ?? null,
    p_only_sponso: opts.onlySponso ?? true,
    p_only_esth: opts.onlyEsth ?? true,
    p_limit: opts.limit ?? 300,
  });
  if (error) {
    console.error("[nexora] sonar_prospects:", error.message);
    return [];
  }
  return (data ?? []) as NexoraProspect[];
}

export async function getSponsoringByRpps(rpps: string[]): Promise<SponsoringTotals[]> {
  const nexora = createNexoraClient();
  if (!nexora || rpps.length === 0) return [];
  const { data, error } = await nexora.rpc("sonar_sponsoring_by_rpps", { p_rpps: rpps });
  if (error) {
    console.error("[nexora] sonar_sponsoring_by_rpps:", error.message);
    return [];
  }
  return (data ?? []) as SponsoringTotals[];
}

export interface SpecialtyByRpps {
  rpps: string;
  specialite: string | null;
  is_esth: boolean;
  is_derm: boolean;
  is_chir: boolean;
  is_gene: boolean;
}

export async function getSpecialitesByRpps(rpps: string[]): Promise<SpecialtyByRpps[]> {
  const nexora = createNexoraClient();
  if (!nexora || rpps.length === 0) return [];
  const { data, error } = await nexora.rpc("sonar_specialite_by_rpps", { p_rpps: rpps });
  if (error) {
    console.error("[nexora] sonar_specialite_by_rpps:", error.message);
    return [];
  }
  return (data ?? []) as SpecialtyByRpps[];
}

export async function getLabsByRpps(rpps: string[]): Promise<LabByRpps[]> {
  const nexora = createNexoraClient();
  if (!nexora || rpps.length === 0) return [];
  const { data, error } = await nexora.rpc("sonar_labs_by_rpps", { p_rpps: rpps });
  if (error) {
    console.error("[nexora] sonar_labs_by_rpps:", error.message);
    return [];
  }
  return (data ?? []) as LabByRpps[];
}

"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { Hcp, HcpSponsorship } from "@/types/database";
import { UserCheck, Award, Building2, Stethoscope } from "lucide-react";

interface HcpOverviewCardProps {
  hcps: Hcp[];
  sponsorships: HcpSponsorship[];
}

export function HcpOverviewCard({ hcps, sponsorships }: HcpOverviewCardProps) {
  const totalHcps = hcps.length;
  const linkedHcps = hcps.filter((h) => h.account_id !== null).length;
  const totalPotentielBoites = hcps.reduce((sum, h) => sum + (h.potentiel_boites ?? 0), 0);

  const totalSponsoMontant = sponsorships.reduce((sum, s) => sum + (s.montant ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Réseau Médecins & Transparence Santé</CardTitle>
          <CardDescription>
            Couverture des professionnels de santé (HCP) et investissements sur le secteur
          </CardDescription>
        </div>
        <Stethoscope size={18} className="text-primary" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserCheck size={14} className="text-primary" />
              <span>Médecins (HCP)</span>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">{formatNumber(totalHcps)}</p>
            <p className="text-[10px] text-muted-foreground">{linkedHcps} rattachés à un compte</p>
          </div>

          <div className="rounded-lg border border-border bg-surface-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Award size={14} className="text-amber-500" />
              <span>Potentiel HCP</span>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">{formatNumber(totalPotentielBoites)}</p>
            <p className="text-[10px] text-muted-foreground">boîtes / an identifiées</p>
          </div>

          <div className="rounded-lg border border-border bg-surface-muted/30 p-3 sm:col-span-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 size={14} className="text-indigo-500" />
              <span>Investissements Sponsoring (Sectoriel)</span>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">
              {totalSponsoMontant > 0 ? formatEUR(totalSponsoMontant) : "Base Transparence"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {sponsorships.length > 0 ? `${sponsorships.length} déclarations recensées` : "Suivi de la concurrence en AURA"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
          <span>Accédez au détail du réseau médical et de la concurrence :</span>
          <Link href="/sponsoring" className="font-medium text-primary hover:underline">
            Voir Sponsoring & Concurrence →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

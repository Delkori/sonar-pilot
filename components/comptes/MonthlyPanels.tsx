"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ForecastPanel } from "@/components/comptes/ForecastPanel";
import type { Account, AccountForecast, ForecastKind } from "@/types/database";

const VUES: { value: ForecastKind; label: string; title: string }[] = [
  { value: "prevision", label: "Prévisionnel", title: "Ce qu'on prévoit de vendre, mois par mois" },
  { value: "objectif", label: "Objectifs", title: "L'objectif du compte réparti sur l'année" },
  { value: "realise", label: "Réalisé", title: "Ce qui a été facturé, mois par mois" },
];

/**
 * Les trois lectures mensuelles du compte dans une seule carte, au lieu de
 * trois cartes empilées de douze lignes chacune : la fiche se lisait en
 * trois écrans de défilement. Les trois panneaux restent montés (masqués,
 * pas démontés) pour qu'une saisie en cours ne disparaisse pas de l'écran
 * quand on change de vue — elle est déjà en base, mais l'écran repartirait
 * des données du chargement.
 */
export function MonthlyPanels({
  accountId,
  account,
  initialForecasts,
  monthlySales,
}: {
  accountId: string;
  account: Account;
  initialForecasts: AccountForecast[];
  monthlySales: { year: number; month: number; ca: number }[];
}) {
  const [vue, setVue] = useState<ForecastKind>("prevision");
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Mois par mois</CardTitle>
        <SegmentedControl value={vue} onChange={setVue} options={VUES} />
      </CardHeader>
      {VUES.map((v) => (
        <div key={v.value} hidden={vue !== v.value}>
          <ForecastPanel
            accountId={accountId}
            account={account}
            initialForecasts={initialForecasts}
            kind={v.value}
            monthlySales={v.value === "objectif" ? undefined : monthlySales}
          />
        </div>
      ))}
    </Card>
  );
}

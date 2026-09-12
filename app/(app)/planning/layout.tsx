import { headers } from "next/headers";
import { PageShell } from "@/components/layout/PageShell";
import { Suspense } from "react";
import { HubTabs } from "@/components/layout/HubTabs";
import { CalendarSyncPanel } from "@/components/relances/CalendarSyncPanel";
import { createClient } from "@/lib/supabase/server";

/**
 * Hub Planning : le mois à planifier (prévisionnel, opportunités) et la
 * semaine à tenir (visites, appels). Deux anciens écrans, un seul point
 * d'entrée — l'abonnement calendrier concerne les deux, il vit ici.
 */
export default async function PlanningLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [tokenRes, hdrs] = await Promise.all([
    supabase.from("calendar_feed_tokens").select("token").limit(1).maybeSingle(),
    headers(),
  ]);
  const host = hdrs.get("host");
  const proto = host?.includes("localhost") ? "http" : "https";
  const feedUrl = tokenRes.data ? `${proto}://${host}/api/calendar.ics?token=${tokenRes.data.token}` : null;

  return (
    <PageShell
      title="Planning"
      subtitle="Le mois à planifier, la semaine à tenir"
      tabs={
        <Suspense>
        <HubTabs
          items={[
            { href: "/planning", label: "Mois", exact: true, hint: "Prévisionnel et opportunités à répartir sur les mois" },
            { href: "/planning/semaine", label: "Semaine", hint: "Visites, appels et temps administratif" },
          ]}
        />
        </Suspense>
      }
      actions={feedUrl ? <CalendarSyncPanel feedUrl={feedUrl} /> : undefined}
      bare
    >
      {children}
    </PageShell>
  );
}

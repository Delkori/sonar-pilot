import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { CalendarSubscribeCard } from "@/components/calendrier/CalendarSubscribeCard";
import { createClient } from "@/lib/supabase/server";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { AccountAction, AccountForecast } from "@/types/database";
import { headers } from "next/headers";
import { CheckCircle2, Circle, Target } from "lucide-react";

export const dynamic = "force-dynamic";

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default async function CalendrierPage() {
  const supabase = await createClient();

  const { data: tokenRow } = await supabase.from("calendar_feed_tokens").select("token").limit(1).maybeSingle();
  const hdrs = await headers();
  const host = hdrs.get("host");
  const proto = host?.includes("localhost") ? "http" : "https";
  const feedUrl = tokenRow ? `${proto}://${host}/api/calendar.ics?token=${tokenRow.token}` : null;

  const { data: actionsRaw } = await supabase
    .from("account_actions")
    .select("*, accounts(id, name)")
    .not("due_date", "is", null)
    .order("due_date", { ascending: true });
  const actions = (actionsRaw ?? []) as (AccountAction & { accounts: { id: string; name: string } | null })[];

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const { data: forecastsRaw } = await supabase
    .from("account_forecasts")
    .select("*, accounts(id, name)")
    .eq("kind", "prevision")
    .eq("year", currentYear)
    .eq("month", currentMonth)
    .order("ca_prevu", { ascending: false });
  const forecasts = (forecastsRaw ?? []) as (AccountForecast & { accounts: { id: string; name: string } | null })[];

  const overdue = actions.filter((a) => !a.done && a.due_date! < now.toISOString().slice(0, 10));
  const upcoming = actions.filter((a) => !a.done && a.due_date! >= now.toISOString().slice(0, 10));
  const totalCaPrevu = forecasts.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);

  return (
    <div>
      <TopBar title="Calendrier" subtitle="Agenda des actions à échéance et du prévisionnel — synchronisable avec l'iPhone" />
      <main className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {overdue.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-danger">En retard ({overdue.length})</CardTitle>
              </CardHeader>
              <ActionList actions={overdue} tone="danger" />
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>À venir</CardTitle>
              <CardDescription>Actions et relances avec échéance</CardDescription>
            </CardHeader>
            <ActionList actions={upcoming} tone="default" />
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Prévisionnel — {MONTH_LABELS[currentMonth - 1]} {currentYear}</CardTitle>
                <CardDescription>{formatEUR(totalCaPrevu)} prévus ce mois-ci</CardDescription>
              </div>
              <Target size={18} className="text-primary" />
            </CardHeader>
            <CardContent className="space-y-2">
              {forecasts.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune prévision pour ce mois.</p>
              )}
              {forecasts.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-sm">
                  <Link href={`/comptes/${f.accounts?.id}`} className="text-foreground hover:text-primary">
                    {f.accounts?.name ?? "Compte"}
                  </Link>
                  <span className="text-muted-foreground">
                    {formatNumber(f.boites_prevues)} boîtes · {formatEUR(f.ca_prevu)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">{feedUrl && <CalendarSubscribeCard feedUrl={feedUrl} />}</div>
      </main>
    </div>
  );
}

function ActionList({
  actions,
  tone,
}: {
  actions: (AccountAction & { accounts: { id: string; name: string } | null })[];
  tone: "danger" | "default";
}) {
  if (actions.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-muted-foreground">Rien à afficher.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {actions.map((a) => (
        <li key={a.id} className="flex items-start gap-3 px-5 py-3">
          {a.type === "action" || a.type === "relance" ? (
            a.done ? <CheckCircle2 size={16} className="mt-0.5 text-success" /> : <Circle size={16} className="mt-0.5 text-muted-foreground" />
          ) : null}
          <div className="flex-1">
            <p className="text-sm text-foreground">{a.content}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {a.accounts && (
                <Link href={`/comptes/${a.accounts.id}`} className="hover:text-primary">
                  {a.accounts.name}
                </Link>
              )}
              {" · "}
              {a.due_date ? new Date(a.due_date).toLocaleDateString("fr-FR") : ""}
            </p>
          </div>
          {tone === "danger" && (
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
              Retard
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

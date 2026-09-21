"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DashboardLayout } from "@/lib/dashboard-layout";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Mise en page du dashboard, enregistrée pour l'utilisateur connecté
 * (`user_preferences`). L'écran change tout de suite ; l'écriture part
 * après une courte pause, pour ne pas envoyer une requête par clic quand
 * on réorganise dix widgets d'affilée.
 */
export function useDashboardLayout(initial: DashboardLayout) {
  const [layout, setLayout] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = useRef<string | null>(null);

  const persist = useCallback(async (next: DashboardLayout) => {
    setStatus("saving");
    const supabase = createClient();
    if (!userId.current) {
      const { data } = await supabase.auth.getUser();
      userId.current = data.user?.id ?? null;
    }
    if (!userId.current) {
      setStatus("error");
      return;
    }
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId.current, dashboard_layout: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setStatus(error ? "error" : "saved");
  }, []);

  const update = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(next), 700);
    },
    [persist]
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { layout, update, status };
}

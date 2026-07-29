"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { CalendarSubscribeCard } from "@/components/calendrier/CalendarSubscribeCard";

export function CalendarSyncPanel({ feedUrl }: { feedUrl: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <CalendarClock size={13} />
        Synchroniser ce planning avec l&apos;iPhone
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-50 w-96">
            <CalendarSubscribeCard feedUrl={feedUrl} />
          </div>
        </>
      )}
    </div>
  );
}

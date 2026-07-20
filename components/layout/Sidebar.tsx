"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Map, UploadCloud, Radar, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/comptes", label: "Comptes", icon: Users },
  { href: "/mapping", label: "Mapping AURA", icon: Map },
  { href: "/admin/import", label: "Import", icon: UploadCloud },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-16 flex-col items-center gap-1 border-r border-border bg-surface py-4">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
        <Radar size={18} />
      </div>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary-50 hover:text-primary",
              active && "bg-primary-50 text-primary"
            )}
          >
            <Icon size={19} />
          </Link>
        );
      })}
      <form action="/auth/signout" method="post" className="mt-auto">
        <button
          type="submit"
          title="Se déconnecter"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <LogOut size={18} />
        </button>
      </form>
    </aside>
  );
}

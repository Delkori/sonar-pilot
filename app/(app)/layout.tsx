import { Sidebar } from "@/components/layout/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background lg:flex">
      <Sidebar />
      {/* `min-w-0` : sans lui, un tableau large force le flex item à s'étendre
          et fait défiler la page entière au lieu du seul tableau. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

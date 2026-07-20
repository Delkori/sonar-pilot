export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur px-8 py-5">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

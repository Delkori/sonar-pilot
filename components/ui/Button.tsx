"use client";

import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

/**
 * Bouton unique de l'app. Les mêmes chaînes de classes ("rounded-lg border
 * border-border px-3 py-1.5 text-sm…") étaient recopiées dans une
 * quarantaine d'endroits, avec des variantes involontaires de padding, de
 * couleur de survol et surtout d'état focus — plusieurs boutons n'étaient
 * tout simplement pas atteignables au clavier de façon visible.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-600 border border-transparent",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-muted",
  ghost: "bg-transparent text-muted-foreground border border-transparent hover:bg-surface-muted hover:text-foreground",
  danger: "bg-transparent text-danger border border-danger/30 hover:bg-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/**
 * Groupe de boutons exclusifs (période, métrique, onglets légers) — motif
 * présent à l'identique sur 5 écrans, chacun avec sa propre mise en forme.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex rounded-lg border border-border bg-surface p-0.5", className)} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              active ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

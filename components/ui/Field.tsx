import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Champs de saisie. Le style « rounded-lg border border-border bg-surface
 * px-3 py-1.5 text-sm outline-none focus:border-primary » était recopié
 * dans plus de vingt composants avec sept variantes de padding — et
 * `outline-none` sans anneau de focus de remplacement, ce qui supprimait
 * purement et simplement l'indicateur de focus clavier. La classe commune
 * ci-dessous rétablit un anneau visible partout.
 */
export const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary " +
  "focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClass, "cursor-pointer pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, "py-2 leading-relaxed", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1 block text-xs font-medium text-muted-foreground", className)} {...props} />
  );
}

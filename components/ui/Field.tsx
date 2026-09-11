import { cn } from "@/lib/utils";
import { fieldClass } from "@/lib/ui-classes";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// La chaîne de classes vit dans `lib/ui-classes` (sans dépendance) et est
// réexportée ici pour que `import { fieldClass } from "@/components/ui/Field"`
// reste valide.
export { fieldClass, fieldClassLg } from "@/lib/ui-classes";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, "w-full", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClass, "w-full cursor-pointer pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, "w-full py-2 leading-relaxed", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1 block text-xs font-medium text-muted-foreground", className)} {...props} />
  );
}

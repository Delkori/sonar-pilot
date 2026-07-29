"use client";

import { useEffect, useState, type ReactNode } from "react";
import { GripVertical, LayoutGrid, RotateCcw } from "lucide-react";

export interface LayoutBlock {
  id: string;
  label: string;
  node: ReactNode;
}

/**
 * Grille de blocs dont l'utilisateur choisit lui-même l'ordre (glisser-
 * déposer), persisté en local (par navigateur) sous `storageKey`. Les blocs
 * inconnus d'un ordre sauvegardé (ex: après une mise à jour du code) sont
 * ignorés ; les nouveaux blocs sont ajoutés à la fin.
 */
export function CustomizableLayout({ storageKey, blocks }: { storageKey: string; blocks: LayoutBlock[] }) {
  const defaultOrder = blocks.map((b) => b.id);
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [customizing, setCustomizing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const savedOrder = JSON.parse(saved) as string[];
      const known = new Set(blocks.map((b) => b.id));
      const filtered = savedOrder.filter((id) => known.has(id));
      const missing = defaultOrder.filter((id) => !filtered.includes(id));
      setOrder([...filtered, ...missing]);
    } catch {
      // ignore malformed storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function persist(next: string[]) {
    setOrder(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function moveTo(id: string, targetId: string) {
    if (id === targetId) return;
    const cur = [...order];
    const from = cur.indexOf(id);
    const to = cur.indexOf(targetId);
    if (from === -1 || to === -1) return;
    cur.splice(from, 1);
    cur.splice(to, 0, id);
    persist(cur);
  }

  function reset() {
    persist(defaultOrder);
  }

  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  const orderedBlocks = order.map((id) => byId.get(id)).filter((b): b is LayoutBlock => !!b);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {customizing && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
          >
            <RotateCcw size={13} />
            Réinitialiser l&apos;ordre
          </button>
        )}
        <button
          onClick={() => setCustomizing((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
            customizing ? "border-primary bg-primary-50 text-primary-700" : "border-border text-muted-foreground hover:bg-surface-muted"
          }`}
        >
          <LayoutGrid size={13} />
          {customizing ? "Terminer la personnalisation" : "Personnaliser l'affichage"}
        </button>
      </div>

      <div className="space-y-6">
        {orderedBlocks.map((block) => (
          <div
            key={block.id}
            draggable={customizing}
            onDragStart={() => setDragId(block.id)}
            onDragOver={(e) => {
              if (customizing) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) moveTo(dragId, block.id);
              setDragId(null);
            }}
            className={
              customizing
                ? "rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/30 p-3 transition-colors hover:border-primary-400"
                : ""
            }
          >
            {customizing && (
              <div className="mb-2 flex cursor-grab items-center gap-1.5 text-xs font-medium text-primary-700 active:cursor-grabbing">
                <GripVertical size={14} />
                {block.label}
              </div>
            )}
            {block.node}
          </div>
        ))}
      </div>
    </div>
  );
}

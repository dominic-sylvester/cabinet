"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { type IntegrationItem, CATEGORY_META, groupByCategory } from "@/lib/integrations/preview-catalog";
import { LogoTile, DimWhenComingSoon, StatusBadge } from "@/components/integrations/hub/integration-visuals";

export function LayoutGallery({ items, onOpen, connectedIds, msWorkAccountConnected }: {
  items: IntegrationItem[];
  onOpen: (id: string) => void;
  connectedIds: Set<string>;
  msWorkAccountConnected: boolean;
}) {
  const groups = groupByCategory(items);
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {groups.length === 0 ? <p className="py-12 text-center text-muted-foreground">No integrations match your search.</p> : (
          <div className="space-y-10">
            {groups.map(group => (
              <section key={group.category}>
                <h2 className="mb-5 text-ui font-semibold">{CATEGORY_META[group.category].label}</h2>
                <div className="flex flex-wrap gap-5">
                  {group.items.map(item => {
                    const suiteConnected = connectedIds.has(item.id) || (!!item.coveredBy && connectedIds.has(item.coveredBy));
                    const connected = suiteConnected && (!item.workAccountOnly || msWorkAccountConnected);
                    return (
                      <button key={item.id} type="button" disabled={!item.implemented}
                        onClick={() => onOpen(item.id)} title={item.name}
                        className={cn("flex w-28 flex-col items-center gap-2.5 rounded-group p-2 text-center transition-colors",
                          item.implemented ? "cursor-pointer hover:bg-accent" : "cursor-default")}>
                        <DimWhenComingSoon implemented={item.implemented} className="flex flex-col items-center gap-2.5">
                          <LogoTile item={item} size={84} />
                          <span className="max-w-24 truncate text-meta font-medium">{item.name}</span>
                        </DimWhenComingSoon>
                        {!item.implemented ? <StatusBadge implemented={false} /> : connected ? (
                          <span className="inline-flex items-center gap-1 rounded-control bg-status-success-bg px-2 py-0.5 text-label text-status-success">
                            <Check className="size-3" />Connected
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

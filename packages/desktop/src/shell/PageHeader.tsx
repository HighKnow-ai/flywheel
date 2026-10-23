/**
 * The top bar of every content surface (direction.md § Click and navigation model): Back when there is a
 * place to return to, the breadcrumb naming where the developer is (project, then the Story or the place,
 * then the session), the ⌘K search, and the surface's own add or run controls on the right.
 *
 * Every crumb but the last is a control that goes to that place; the last is the page itself and inert.
 */
import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { useUiStore } from "../state/uiStore";

export interface Crumb {
  label: ReactNode;
  /** Goes to that place. The last crumb is the page itself and never takes one. */
  onSelect?: () => void;
  /** Story keys and session ids are set in the code face. */
  mono?: boolean;
  /** The accessible name of a crumb that is a control, when its label alone would be ambiguous. */
  ariaLabel?: string;
}

export interface PageHeaderProps {
  crumbs: Crumb[];
  onBack?: () => void;
  /** The surface's own controls: add, run, view switches. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ crumbs, onBack, actions, className }: PageHeaderProps) {
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  return (
    <header className={cn("flex h-14 shrink-0 items-center gap-3 px-5", className)}>
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2.5">
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
      )}
      <Breadcrumb aria-label="You are here" className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap text-body">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            const text = <span className={cn("block truncate", crumb.mono && "font-mono text-small")}>{crumb.label}</span>;
            return (
              <BreadcrumbItem key={index} className={cn("min-w-0", last ? "shrink" : "shrink-0")}>
                {index > 0 && (
                  <BreadcrumbSeparator className="mr-1 text-subtle-foreground">
                    <span aria-hidden="true">/</span>
                  </BreadcrumbSeparator>
                )}
                {last || !crumb.onSelect ? (
                  <BreadcrumbPage className={cn("block min-w-0 truncate", last ? "font-semibold" : "text-muted-foreground")}>
                    {text}
                  </BreadcrumbPage>
                ) : (
                  <button
                    type="button"
                    onClick={crumb.onSelect}
                    aria-label={crumb.ariaLabel}
                    className="min-w-0 rounded-sm font-semibold text-foreground underline-offset-4 transition-colors duration-(--duration-state) ease-(--ease) hover:underline"
                  >
                    {text}
                  </button>
                )}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <Button
        variant="outline"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search, ⌘K"
        className="w-52 justify-start font-normal text-subtle-foreground"
      >
        <Search aria-hidden="true" />
        Search
        <Kbd className="ml-auto">⌘K</Kbd>
      </Button>
      {actions}
    </header>
  );
}

/** The ground every surface's content sits in: the floor, padded to the header's gutter. It is the surface's
 * scroll container, so a virtualised list inside it (the board, #116) takes it by `ref`. */
export function SurfaceBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5", className)} {...props} />;
}

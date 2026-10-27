/**
 * The top bar of every content surface (direction.md § Click and navigation model): Back when there is a
 * place to return to, the breadcrumb naming where the developer is (project, then the Story or the place,
 * then the session), the ⌘K search, and the surface's own add or run controls on the right.
 *
 * Every crumb but the last is a control that goes to that place; the last is the page itself and inert.
 *
 * The header fits every window (issue #199). It is a size container: below 52rem of header, about an 1100px
 * window beside the 16rem rail, Search folds to an icon Button whose ⌘K hint moves into its Tooltip, and the
 * crumbs between the first and the last fold into BreadcrumbEllipsis, a menu that still goes to each of them.
 * Every crumb is `min-w-0` and truncates, so a long project name or Story key ends in an ellipsis instead of
 * sliding under Search and the add buttons.
 */
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/Button";
import {
  Kbd,
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@highknow/design";
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

function CrumbText({ crumb }: { crumb: Crumb }) {
  return (
    <span data-crumb-text="" className={cn("block truncate", crumb.mono && "font-mono text-small")}>
      {crumb.label}
    </span>
  );
}

/**
 * A crumb that ends in an ellipsis shows its whole text in a Tooltip; one that fits shows none, so hovering the
 * breadcrumb never repeats what is already on screen. Truncation is measured when the Tooltip would open.
 */
function CrumbTip({ crumb, children }: { crumb: Crumb; children: ReactNode }) {
  const trigger = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  function truncated() {
    const text = trigger.current?.querySelector<HTMLElement>("[data-crumb-text]");
    return !!text && text.scrollWidth > text.clientWidth;
  }
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && truncated())}>
      <TooltipTrigger
        asChild
        ref={(element) => {
          trigger.current = element;
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className={cn("max-w-sm break-words", crumb.mono && "font-mono")}>{crumb.label}</TooltipContent>
    </Tooltip>
  );
}

function Separator({ className }: { className?: string }) {
  return (
    <BreadcrumbSeparator className={cn("shrink-0 text-subtle-foreground", className)}>
      <span aria-hidden="true">/</span>
    </BreadcrumbSeparator>
  );
}

function CrumbItem({ crumb, last, className }: { crumb: Crumb; last: boolean; className?: string }) {
  return (
    // A place before the page gives way first and never takes more than 14rem; the page itself keeps at least 6rem.
    <BreadcrumbItem className={cn(last ? "min-w-24 shrink" : "max-w-56 min-w-0 shrink-[4]", className)}>
      {last || !crumb.onSelect ? (
        <CrumbTip crumb={crumb}>
          <BreadcrumbPage className={cn("block min-w-0 truncate", last ? "font-semibold" : "text-muted-foreground")}>
            <CrumbText crumb={crumb} />
          </BreadcrumbPage>
        </CrumbTip>
      ) : (
        <CrumbTip crumb={crumb}>
          <button
            type="button"
            onClick={crumb.onSelect}
            aria-label={crumb.ariaLabel}
            className="block max-w-full min-w-0 rounded-sm text-left font-semibold text-foreground underline-offset-4 transition-colors duration-(--duration-feedback) ease-(--ease) hover:underline"
          >
            <CrumbText crumb={crumb} />
          </button>
        </CrumbTip>
      )}
    </BreadcrumbItem>
  );
}

/** The folded crumbs, as a menu that still goes to each of them. Shown only on a narrow header. */
function FoldedCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <BreadcrumbItem className="shrink-0 @min-[52rem]/header:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Show the folded places"
          className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-(--duration-feedback) ease-(--ease) hover:bg-accent hover:text-foreground aria-expanded:bg-accent"
        >
          <BreadcrumbEllipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {crumbs.map((crumb, index) => (
            <DropdownMenuItem key={index} disabled={!crumb.onSelect} onSelect={() => crumb.onSelect?.()}>
              <CrumbText crumb={crumb} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </BreadcrumbItem>
  );
}

export function PageHeader({ crumbs, onBack, actions, className }: PageHeaderProps) {
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const middle = crumbs.slice(1, -1);
  const items: ReactNode[] = [];
  crumbs.forEach((crumb, index) => {
    const last = index === crumbs.length - 1;
    // A middle crumb (and the separator before it) is drawn only on a wide header; on a narrow one it is in the menu.
    const folded = index > 0 && !last ? "hidden @min-[52rem]/header:inline-flex" : undefined;
    if (last && middle.length > 0) {
      items.push(<Separator key="folded-sep" className="@min-[52rem]/header:hidden" />);
      items.push(<FoldedCrumbs key="folded" crumbs={middle} />);
    }
    if (index > 0) items.push(<Separator key={`sep-${index}`} className={folded} />);
    items.push(<CrumbItem key={index} crumb={crumb} last={last} className={folded} />);
  });
  return (
    <header className={cn("@container/header flex h-14 shrink-0 items-center gap-3 px-5", className)}>
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2.5">
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
      )}
      <Breadcrumb aria-label="You are here" className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-1.5 text-body">{items}</BreadcrumbList>
      </Breadcrumb>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search, ⌘K"
            className="w-8.5 justify-center px-0 font-normal text-subtle-foreground @min-[52rem]/header:w-52 @min-[52rem]/header:justify-start @min-[52rem]/header:px-3.5"
          >
            <Search aria-hidden="true" />
            <span className="hidden @min-[52rem]/header:inline">Search</span>
            <Kbd className="ml-auto hidden @min-[52rem]/header:inline-flex">⌘K</Kbd>
          </Button>
        </TooltipTrigger>
        {/* Only the folded icon needs it: the wide Button already says Search and shows its key. */}
        <TooltipContent className="@min-[52rem]/header:hidden">
          Search <Kbd>⌘K</Kbd>
        </TooltipContent>
      </Tooltip>
      {actions}
    </header>
  );
}

/** The ground every surface's content sits in: the floor, padded to the header's gutter. It is the surface's
 * scroll container, so a virtualised list inside it (the board, #116) takes it by `ref`. It is positioned so it
 * is the containing block of the absolutely positioned things in it (every `sr-only` label): they scroll and clip
 * with it instead of lying on the document far below the window and making the window scroll (issue #191). */
export function SurfaceBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("relative min-h-0 flex-1 overflow-y-auto px-5 pb-5", className)} {...props} />;
}

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"
import { Spinner } from "@/components/ui/spinner"

/*
 * Every action (direction.md § Components, rule 2). One filled primary per region, brand blue. The only
 * other filled colour is `attention`, and only on an item that is Waiting on you (Answer, Allow once).
 * `destructive` is a text button (Drop), set apart from the primary, and always confirms in an AlertDialog.
 * On a Gated action Deny leads as the filled `neutral` (ink fill) and Allow once is outline.
 * Buttons carry an icon and a word; the focus ring is the 2px --ring at a 2px offset (styles/globals.css).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent font-semibold whitespace-nowrap transition-colors duration-(--duration-state) ease-(--ease) select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_1px_0_rgb(0_0_0/0.15)] hover:bg-primary/90",
        attention: "bg-attention text-attention-foreground shadow-[0_1px_0_rgb(0_0_0/0.15)] hover:bg-attention/90",
        // The filled neutral (ink fill): Deny leading on a Gated action, where approve-by-muscle-memory must
        // land on the safe answer without spending the brand or the attention colour on a refusal.
        neutral: "bg-foreground text-card shadow-[0_1px_0_rgb(0_0_0/0.15)] hover:bg-foreground/85",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline:
          "border-input bg-card text-foreground hover:border-foreground aria-expanded:border-foreground",
        ghost: "text-foreground hover:bg-accent aria-expanded:bg-accent",
        destructive: "text-destructive-text hover:bg-accent",
        link: "h-auto px-0 text-running underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8.5 px-3.5 text-body has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-meta [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7.5 gap-1 px-2.75 text-small has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-[15px]",
        lg: "h-10 px-4 text-row",
        icon: "size-8.5",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7.5",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** Whether a child is the button's leading icon: an `<svg>` or a component element (a Lucide glyph, `Icon`). */
function isIcon(child: React.ReactNode): child is React.ReactElement<{ className?: string }> {
  return React.isValidElement(child) && (child.type === "svg" || typeof child.type !== "string")
}

/**
 * The children of a pending button (DESIGN.md § Feedback): the Spinner takes the leading icon's place, at the
 * icon's own size classes, so the label stays and the width does not move. A button with no icon gains the
 * Spinner before its label; give a button that can be pending an icon (Buttons carry an icon and a word).
 */
function withSpinner(children: React.ReactNode): React.ReactNode {
  const items = React.Children.toArray(children)
  const [first, ...rest] = items
  const leading = isIcon(first) ? first : null
  const spinner = (
    <Spinner
      key="spinner"
      role={undefined}
      aria-label={undefined}
      aria-hidden="true"
      className={leading?.props.className}
      {...(leading && "data-icon" in (leading.props as object)
        ? { "data-icon": (leading.props as { "data-icon"?: string })["data-icon"] }
        : {})}
    />
  )
  return leading ? [spinner, ...rest] : [spinner, ...items]
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * Pending: shows the Spinner in place of the icon, keeps the label and the width, sets `aria-busy`, and
     * swallows clicks. The button stays focusable (`aria-disabled`, not `disabled`), so focus is not lost
     * mid-action. Not available with `asChild`.
     */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const pending = loading && !asChild

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={pending || undefined}
      aria-busy={pending || undefined}
      aria-disabled={pending || props["aria-disabled"] || undefined}
      className={cn(buttonVariants({ variant, size, className }), pending && "cursor-progress")}
      onClick={
        pending
          ? (event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
            }
          : onClick
      }
      {...props}
    >
      {pending ? withSpinner(children) : children}
    </Comp>
  )
}

export { Button, buttonVariants }

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * Pills (direction.md § Components). The four tone variants are the only state colours a badge may wear:
 * `attention` is Waiting on you, `running` an agent at work, `destructive` Stopped or failed, and `neutral`
 * everything else, told apart by its icon and word. A state picks its tone through components/StateBadge.tsx,
 * never here. `secondary`, `outline` and `ghost` are for counts and kinds that are not states.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 text-[13px] leading-none font-semibold whitespace-nowrap transition-colors duration-(--duration-state) ease-(--ease) has-data-[icon=inline-start]:pl-2 has-data-[icon=inline-end]:pr-2 [&>svg]:pointer-events-none [&>svg]:size-[15px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        attention: "bg-attention font-bold text-attention-foreground",
        running: "bg-running-muted text-running",
        destructive: "bg-destructive font-bold text-destructive-foreground",
        neutral: "border-border bg-secondary text-secondary-foreground",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-accent",
        outline: "border-border text-foreground [a]:hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-running underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

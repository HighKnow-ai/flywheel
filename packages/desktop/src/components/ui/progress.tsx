"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  // Flywheel: `value` and `max` reach Radix, so the bar says aria-valuenow/-max; the stock component kept them back.
  const percent = max > 0 ? ((value || 0) / max) * 100 : 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }

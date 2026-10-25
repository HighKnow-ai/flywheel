"use client"

import { Collapsible as CollapsiblePrimitive } from "radix-ui"

/*
 * Every disclosure (DESIGN.md § Motion). CollapsibleContent grows to the height Radix measures
 * (`--radix-collapsible-content-height`) on the overlay duration and shrinks back on the faster exit, so
 * every disclosure built on it opens and closes the same way; under reduced motion it cross-fades instead.
 * The keyframes live in styles/globals.css, keyed on `data-slot="collapsible-content"`.
 */
function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

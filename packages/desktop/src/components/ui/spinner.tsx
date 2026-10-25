import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

/*
 * Pending (DESIGN.md § Feedback). A 16px ring turning once a second on its own: alone it is a status and
 * names itself "Loading"; inside a loading Button it is silent and the button's aria-busy speaks. Under
 * reduced motion it breathes instead of turning (styles/globals.css), so pending still reads.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }

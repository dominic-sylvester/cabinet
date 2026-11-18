import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--control-height)] w-full min-w-0 rounded-control border border-input bg-surface-sheet px-3 py-1 text-base text-foreground transition-colors duration-[var(--motion-feedback)] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-meta file:font-medium file:text-foreground placeholder:text-ink-secondary focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive md:text-ui",
        className
      )}
      {...props}
    />
  )
}

export { Input }

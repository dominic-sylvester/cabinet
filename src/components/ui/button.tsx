"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding text-ui font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-[var(--motion-feedback)] select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        outline: "border-input bg-surface-sheet hover:bg-surface-hover hover:text-foreground aria-expanded:bg-selection aria-expanded:text-selection-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-surface-pressed aria-expanded:bg-selection aria-expanded:text-selection-foreground",
        highlight: "bg-status-warning-bg text-status-warning hover:bg-status-warning/20 aria-expanded:bg-status-warning/20",
        ghost: "text-ink-secondary hover:bg-surface-hover hover:text-foreground aria-expanded:bg-selection aria-expanded:text-selection-foreground",
        destructive: "bg-status-danger-bg text-status-danger hover:bg-status-danger/20 focus-visible:outline-status-danger",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--control-height)] gap-1.5 px-3",
        xs: "h-6 gap-1 px-2 text-label [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--control-height-compact)] gap-1.5 px-2.5 text-meta [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[var(--control-height-prominent)] gap-2 px-4",
        icon: "size-[var(--control-height)]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--control-height-compact)] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-[var(--control-height-prominent)]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      nativeButton={!props.render}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

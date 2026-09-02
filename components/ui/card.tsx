import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const surfaceCardVariants = cva("border", {
  variants: {
    tone: {
      default:
        "border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]",
      glass:
        "border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.94))] ring-1 ring-slate-200/70 backdrop-blur",
    },
    shadow: {
      soft: "shadow-[0_14px_32px_rgba(15,23,42,0.08)]",
      panel: "shadow-[0_20px_48px_rgba(15,23,42,0.10)]",
    },
    radius: {
      lg: "rounded-3xl",
      xl: "rounded-[30px]",
    },
  },
  defaultVariants: { tone: "default", shadow: "soft", radius: "lg" },
})

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

type SurfaceCardProps<T extends React.ElementType = "div"> = {
  as?: T
  className?: string
} & VariantProps<typeof surfaceCardVariants> &
  Omit<React.ComponentPropsWithoutRef<T>, "as" | "className">

function SurfaceCard<T extends React.ElementType = "div">({
  as,
  className,
  tone,
  shadow,
  radius,
  ...props
}: SurfaceCardProps<T>) {
  const Comp = as || "div"

  return (
    <Comp
      data-slot="surface-card"
      className={cn(surfaceCardVariants({ tone, shadow, radius }), className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  SurfaceCard,
  surfaceCardVariants,
}

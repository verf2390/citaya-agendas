import * as React from "react"

import { cn } from "@/lib/utils"

type DemoShellProps = React.ComponentProps<"main">

function DemoShell({ className, ...props }: DemoShellProps) {
  return (
    <main
      className={cn(
        "min-h-screen bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.08),transparent_28%),linear-gradient(180deg,#ecf2f8_0%,#f8fafc_28%,#eef3f8_100%)]",
        className
      )}
      {...props}
    />
  )
}

type DemoContainerProps = React.ComponentProps<"div"> & {
  size?: "default" | "hero" | "booking"
}

function DemoContainer({
  className,
  size = "default",
  ...props
}: DemoContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        size === "default" && "max-w-[1120px] px-4",
        size === "hero" && "max-w-[1120px] px-4 pb-20 pt-6 sm:pt-10",
        size === "booking" &&
          "max-w-[460px] px-3 pb-28 pt-2 sm:max-w-3xl sm:px-4 sm:pb-16 sm:pt-4 lg:max-w-6xl lg:px-6 lg:pb-24 lg:pt-6",
        className
      )}
      {...props}
    />
  )
}

export { DemoShell, DemoContainer }

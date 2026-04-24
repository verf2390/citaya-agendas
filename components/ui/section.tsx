import * as React from "react"

import { SurfaceCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type SectionProps = React.ComponentProps<"section">

function Section({ className, ...props }: SectionProps) {
  return (
    <SurfaceCard
      as="section"
      tone="glass"
      shadow="panel"
      radius="xl"
      className={cn("p-3 sm:p-5", className)}
      {...props}
    />
  )
}

export { Section }

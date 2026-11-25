import { Badge } from "@medusajs/ui"

export type ChipInput = { state: string; is_live: boolean; has_pending: boolean }

type ChipColor = "grey" | "blue" | "orange" | "green" | "red" | "purple"

// The label is the signal. The colour only supports it.
export const chipFor = ({ state, is_live, has_pending }: ChipInput): { label: string; color: ChipColor } => {
  if (state === "submitted") {
    return is_live ? { label: "Live edit in review", color: "purple" } : { label: "In review", color: "blue" }
  }
  if (state === "approved") {
    return has_pending ? { label: "Live edit in review", color: "purple" } : { label: "Live", color: "green" }
  }
  if (state === "changes_requested") return { label: "Changes requested", color: "orange" }
  if (state === "rejected") return { label: "Rejected", color: "red" }
  if (state === "withdrawn") return { label: "Withdrawn", color: "grey" }
  return { label: "Draft", color: "grey" }
}

export const StateChip = (props: ChipInput) => {
  const chip = chipFor(props)
  return (
    <Badge size="2xsmall" color={chip.color} data-testid="state-chip">
      {chip.label}
    </Badge>
  )
}

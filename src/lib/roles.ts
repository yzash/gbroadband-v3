/** Roles gate which proposals a user can approve. No auth — a pure role switcher. */
export type Role = "cx_ops" | "noc_lead" | "readonly";

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "noc_lead", label: "NOC Lead", blurb: "Approves dispatch & confirming tests" },
  { id: "cx_ops", label: "CX Ops", blurb: "Approves comms & credits" },
  { id: "readonly", label: "Read-only", blurb: "Observes; approves nothing" },
];

/** Which proposal kinds a role may approve. */
export type ProposalKind =
  | "remote_action"
  | "confirming_test"
  | "dispatch"
  | "notification"
  | "credit";

export function canApprove(role: Role, kind: ProposalKind): boolean {
  switch (role) {
    case "noc_lead":
      return kind === "dispatch" || kind === "confirming_test" || kind === "remote_action";
    case "cx_ops":
      return kind === "notification" || kind === "credit";
    case "readonly":
      return false;
  }
}

export function roleLabel(role: Role): string {
  return ROLES.find((r) => r.id === role)?.label ?? role;
}

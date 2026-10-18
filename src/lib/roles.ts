/** Personas gate which proposals a user can approve. No auth — a pure persona
 *  switcher. Who the personas are (names, jobs, benefits) lives in personas.ts. */
export type Role =
  | "noc_lead"
  | "customer_service"
  | "sales_force"
  | "cfs_tech"
  | "partner"
  | "marketing"
  | "readonly";

export const ROLE_IDS: Role[] = ["noc_lead", "customer_service", "sales_force", "cfs_tech", "partner", "marketing", "readonly"];

/** Which proposal kinds a role may approve. */
export type ProposalKind =
  | "remote_action"
  | "confirming_test"
  | "dispatch"
  | "notification"
  | "credit"
  | "account_alert"
  | "home_visit"
  | "campaign_hold"
  | "retention_offer";

export const PROPOSAL_LABEL: Record<ProposalKind, string> = {
  remote_action: "Remote fix",
  confirming_test: "Confirming test",
  dispatch: "Partner dispatch",
  notification: "Customer notice",
  credit: "Service credit",
  account_alert: "Account heads-up",
  home_visit: "Home visit",
  campaign_hold: "Campaign hold",
  retention_offer: "Retention offer",
};

/** The persona that owns each decision. */
export const APPROVER: Record<ProposalKind, Role> = {
  remote_action: "noc_lead",
  confirming_test: "noc_lead",
  dispatch: "noc_lead",
  notification: "customer_service",
  credit: "customer_service",
  account_alert: "sales_force",
  home_visit: "cfs_tech",
  campaign_hold: "marketing",
  retention_offer: "marketing",
};

export function canApprove(role: Role, kind: ProposalKind): boolean {
  return APPROVER[kind] === role;
}

/** Older builds stored "cx_ops"; it became Customer Service. */
export function normalizeRole(r: string | null | undefined): Role | null {
  if (!r) return null;
  if (r === "cx_ops") return "customer_service";
  return (ROLE_IDS as string[]).includes(r) ? (r as Role) : null;
}

export function roleLabel(role: string): string {
  const r = normalizeRole(role);
  return r ? ROLE_LABEL[r] : role;
}

export const ROLE_LABEL: Record<Role, string> = {
  noc_lead: "NOC Lead",
  customer_service: "Customer Service",
  sales_force: "Sales Force",
  cfs_tech: "CFS Technician",
  partner: "Last-mile Partner",
  marketing: "Brand & Marketing",
  readonly: "Read-only",
};

import type { Role } from "./roles";

/**
 * The people who run on the SDAL framework. Names are placeholders — rename
 * them here and every screen follows. Each persona owns part of the loop and
 * hands work to the others; `handsTo` drives the persona-dynamics diagram.
 */
export interface Persona {
  role: Role;
  name: string;
  title: string;
  team: string;
  /** Short team name used on labels, lanes and chips. */
  group: string;
  initials: string;
  color: string;
  /** Their workspace in the app. */
  home: string;
  /** Where they sit in Sense · Decide · Act · Learn. */
  stages: ("Sense" | "Decide" | "Act" | "Learn")[];
  /** The question they bring to SDAL every day. */
  question: string;
  uses: string[];
  benefits: string[];
  /** What they approve or submit (empty for observers). */
  owns: string;
}

export const PERSONAS: Persona[] = [
  {
    role: "noc_lead",
    name: "Marco Reyes",
    title: "NOC Lead",
    team: "Network Operations Center",
    group: "NOC",
    initials: "MR",
    color: "#2F6BFF",
    home: "/incidents",
    stages: ["Sense", "Decide", "Act"],
    question: "What is actually broken, where, and who should fix it?",
    uses: [
      "Sees every outage on one live map, even where telemetry is dark",
      "Gets the exact failed element ranked with confidence, records conflicts flagged",
      "Approves remote fixes, confirming tests and partner dispatches",
    ],
    benefits: ["Right truck, right place, first time", "Fewer wrong rolls and duplicate dispatches", "Repairs inside the 6-hour window"],
    owns: "Remote fixes · confirming tests · partner dispatch",
  },
  {
    role: "customer_service",
    name: "Joy Santos",
    title: "Contact Center Lead",
    team: "Customer Service",
    group: "Customer Service",
    initials: "JS",
    color: "#3CB7FF",
    home: "/care",
    stages: ["Act", "Learn"],
    question: "When a customer calls, do we already know — and what do we tell them?",
    uses: [
      "Looks up any caller and sees the known outage, cause, crew status and ETA instantly",
      "Approves proactive cause-and-ETA notices to everyone affected, including silent customers",
      "Approves service credits when a repair runs past the window",
    ],
    benefits: ["Fewer calls: customers hear from us first", "Every agent gives the same, accurate answer", "No home visit booked for a network fault"],
    owns: "Customer notices · service credits",
  },
  {
    role: "sales_force",
    name: "Paolo Cruz",
    title: "Account Manager",
    team: "Sales Force",
    group: "Sales Force",
    initials: "PC",
    color: "#FFC542",
    home: "/sales",
    stages: ["Act"],
    question: "Are my accounts affected — and where should I sell this week?",
    uses: [
      "Sees which business and VIP accounts are hit, before they call",
      "Approves a personal heads-up to each account with cause and ETA",
      "Sells where the network is healthy; holds where it is not",
    ],
    benefits: ["Accounts hear it from their AM first", "No selling into an active outage", "Credible, data-backed conversations"],
    owns: "Account heads-ups",
  },
  {
    role: "cfs_tech",
    name: "Ramon Dizon",
    title: "CFS Home-Visit Technician",
    team: "Customer Facing Service (CFS)",
    group: "CFS",
    initials: "RD",
    color: "#1FC98E",
    home: "/field",
    stages: ["Act", "Learn"],
    question: "Does this customer really need a home visit — and what will I find?",
    uses: [
      "Only gets visits for home-side faults that remote fixes could not solve",
      "Arrives with a brief: diagnostics already run, signal levels, likely part",
      "Sees which callers are inside a network outage, so no visit is booked",
    ],
    benefits: ["Fewer wasted home visits", "Fixed on the first visit", "More time for customers who need a technician"],
    owns: "Home visits",
  },
  {
    role: "partner",
    name: "Dante Villanueva",
    title: "Crew Lead · Southgrid Splice",
    team: "Last-mile Partner",
    group: "Last-mile Partner",
    initials: "DV",
    color: "#FF8A3D",
    home: "/partners",
    stages: ["Act", "Learn"],
    question: "Where exactly do I go, what do I bring — and does my feedback count?",
    uses: [
      "Receives a dispatch brief: suspect element, confidence, parts, customers affected",
      "Submits a structured close-out: where the fault really was, root cause, record errors seen",
      "Sees a scorecard and how every close-out sharpened the next dispatch",
    ],
    benefits: ["Fewer wasted trips", "Fair, data-backed scorecard", "Feedback that visibly changes the plant records"],
    owns: "Close-out reports (the last-mile feedback loop)",
  },
  {
    role: "marketing",
    name: "Bea Navarro",
    title: "Acquisition & Base Lead",
    team: "Brand & Marketing · Acquisition, Base & Comms",
    group: "Brand & Marketing",
    initials: "BN",
    color: "#A98BFF",
    home: "/marketing",
    stages: ["Act", "Learn"],
    question: "Are we spending to acquire into an outage — and are we keeping the customers we have?",
    uses: [
      "Holds acquisition campaigns in cities with an active outage",
      "Approves retention offers for customers down the longest",
      "Owns the voice of every outage message, measured against a holdout",
    ],
    benefits: ["No ad spend into a broken experience", "Measurable retention lift", "One consistent brand voice in a crisis"],
    owns: "Campaign holds · retention offers",
  },
];

export const READONLY_PERSONA: Persona = {
  role: "readonly",
  name: "Observer",
  title: "Read-only",
  team: "Leadership view",
    group: "Leadership",
  initials: "RO",
  color: "#7586AE",
  home: "/operations",
  stages: [],
  question: "How is the operation doing right now?",
  uses: ["Sees everything, approves nothing"],
  benefits: ["One shared picture"],
  owns: "Nothing — observes",
};

export function personaFor(role: Role): Persona {
  return PERSONAS.find((p) => p.role === role) ?? READONLY_PERSONA;
}

/**
 * Hand-offs between personas during one outage — the dynamics. Each edge is
 * "from hands `what` to to". Order follows a typical incident.
 */
export const HANDOFFS: { from: Role; to: Role; what: string }[] = [
  { from: "noc_lead", to: "partner", what: "Dispatch brief: exact element, parts" },
  { from: "noc_lead", to: "customer_service", what: "Confirmed cause + repair ETA" },
  { from: "customer_service", to: "cfs_tech", what: "Only home-side faults need a visit" },
  { from: "noc_lead", to: "sales_force", what: "Business accounts affected" },
  { from: "noc_lead", to: "marketing", what: "Cities with active outages" },
  { from: "customer_service", to: "marketing", what: "Customers down the longest" },
  { from: "partner", to: "noc_lead", what: "Close-out: true fault + record errors" },
  { from: "cfs_tech", to: "noc_lead", what: "Home-visit findings" },
];

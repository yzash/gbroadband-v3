/**
 * Synthetic display names for subscribers. Derived from a hash of the
 * subscriber id (not the seed RNG), so adding names never shifts the
 * generated world. All names are fictional.
 */
const FIRST = [
  "Maria", "Jose", "Ana", "Juan", "Carmela", "Rafael", "Liza", "Miguel", "Andrea", "Paolo",
  "Kristine", "Mark", "Angelica", "Joshua", "Patricia", "Carlo", "Bianca", "Gabriel", "Nicole", "Enrique",
  "Camille", "Rico", "Trisha", "Jerome", "Danica", "Bryan", "Hazel", "Nathan", "Jasmine", "Aldrin",
  "Rowena", "Dennis", "Katrina", "Ramil", "Shiela", "Vincent", "Grace", "Arnel", "Lorna", "Edgar",
];
const LAST = [
  "Dela Cruz", "Santos", "Reyes", "Garcia", "Mendoza", "Bautista", "Villanueva", "Ramos", "Aquino", "Castillo",
  "Flores", "Gonzales", "Navarro", "Torres", "Domingo", "Lopez", "Mercado", "Aguilar", "Pascual", "Salazar",
  "Fernandez", "Rivera", "Soriano", "Manalo", "Ocampo", "Tolentino", "Dizon", "Valdez", "Gutierrez", "Cruz",
];
const BIZ_HEAD = [
  "Kalye", "Bahay", "Sampaguita", "Tala", "Bituin", "Mabuhay", "Isla", "Lakan", "Dalisay", "Hiraya",
  "Bayani", "Silangan", "Liwayway", "Pag-asa", "Tanglaw", "Kalinaw", "Agos", "Habagat", "Amihan", "Sinag",
];
const BIZ_TAIL = [
  "Dental Clinic", "Law Office", "Bakeshop", "Logistics", "Pharmacy", "Coffee Roasters", "Design Studio",
  "Accounting Services", "Learning Center", "Hardware", "Diagnostics", "Travel & Tours", "Printing Press",
  "Realty", "Veterinary Clinic", "Grill", "BPO Hub", "Motor Parts", "Salon", "Trading",
];

function h(s: string, salt: number): number {
  let x = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

export function subscriberName(subId: string, b2b: boolean): string {
  if (b2b) return `${BIZ_HEAD[h(subId, 1) % BIZ_HEAD.length]} ${BIZ_TAIL[h(subId, 2) % BIZ_TAIL.length]}`;
  return `${FIRST[h(subId, 3) % FIRST.length]} ${LAST[h(subId, 4) % LAST.length]}`;
}

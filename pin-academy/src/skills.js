// Pin skills (Vee, 2026-10-07): every call is grouped by the situation it teaches, so a class can get two practice
// calls and one test on the same thing. Replaces the old "Type of place". The one-line tips come from Vee's pin posts
// in Slack and the op reports; trainees see them above each group on the Practice page.
export const PIN_SKILLS = [
  { name: 'Place or business name', tip: 'Ask for the name of the place and search it by name. The address alone can drop the pin on the building next door.' },
  { name: 'Past rides', tip: "Use the End Location coordinates from the customer's past rides, never the destination field." },
  { name: 'Multiple entrances', tip: 'Malls, Walmart, plazas: ask which entrance or side they will be at, pick it, and say it in the driver note.' },
  { name: 'Hospitals and clinics', tip: 'Big buildings with many doors: ask which entrance or building they will be at.' },
  { name: 'Airports', tip: 'Pick the right terminal and put the airline in the driver note.' },
  { name: 'Apartments and complexes', tip: 'Complexes and senior living have more than one building and entrance: ask which one.' },
  { name: 'Drop-off checks', tip: 'The drop-off pin matters as much as the pickup: confirm where they are going and check that pin too.' },
  { name: 'Confirm the address', tip: 'Have them repeat the address, read it back, and check the city. Look-alike street names trip people up.' },
  { name: 'Other', tip: '' },
];
const NAMES = new Set(PIN_SKILLS.map((s) => s.name));

// The old "Type of place" values, each moved to the skill it teaches.
const FROM_TYPE = {
  'Restaurant or shop': 'Place or business name', Hospital: 'Hospitals and clinics', 'Medical office': 'Hospitals and clinics',
  Airport: 'Airports', 'Apartment complex': 'Apartments and complexes', 'Senior living': 'Apartments and complexes',
  'Gated community': 'Apartments and complexes', 'Shopping center': 'Multiple entrances',
};
export const pinSkill = (v) => (NAMES.has(v) ? v : FROM_TYPE[v] || 'Other');

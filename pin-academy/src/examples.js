// Worked examples from real training cases Vee uses. Public places only; customer details are made up.
// Admins add them from the Scenarios page ("Add the example scenarios"). Coordinates are Vee's, from the dashboard.
export const EXAMPLE_SCENARIOS = [
  {
    title: "Menchie's on Petrovitsky Road",
    category: 'Restaurant or shop',
    data: {
      caller: "Hi, I need a ride home. Can you pick me up at 14060 Southeast Petrovitsky Road in Renton? I'm at Menchie's.",
      why: "Typed as an address only, this drops the pin on the building next door, and that is exactly where a driver went once: the customer was never picked up. "
        + "Type the business name in the same address box (start with \"Men\") and pick Menchie's from the list: the pin moves about 40 m to the right storefront. "
        + "Always add the place name the customer mentions, then check the pin on satellite and Street View.",
      stops: [{
        kind: 'pickup', label: "Menchie's Frozen Yogurt",
        addressGiven: '14060 SE Petrovitsky Rd, Renton, WA 98058',
        start: { lat: 47.4460548, lng: -122.1517119 },   // what the address alone returns
        answer: { lat: 47.4460118, lng: -122.1522953 },  // what "Menchie's" returns
        entrances: [],
      }],
      questions: [
        { q: 'Which business or building are you at?', a: "I'm at Menchie's, the frozen yogurt place.", needed: true },
        { q: 'What are you wearing, so the driver can spot you?', a: 'A blue top and black jeans.', needed: true },
        { q: 'Is this the best number for the driver to call you?', a: 'Yes, this number.', needed: false },
        { q: 'Can you spell the street name?', a: 'P-E-T-R-O-V-I-T-S-K-Y.', needed: false },
      ],
      note: {
        mustMention: ["Menchie", 'blue', 'jeans'],
        model: "Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans.",
      },
    },
  },
];

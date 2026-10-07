// Worked examples from real training cases Vee uses. Public places only; customer details are made up.
// Admins add them from the Scenarios page ("Add / refresh the examples"). Coordinates are Vee's, from the dashboard.
// The caller only says what they want; the trainee gets the rest by asking, the way a real call goes.
export const EXAMPLE_SCENARIOS = [
  {
    title: "Menchie's on Petrovitsky Road",
    category: 'Restaurant or shop',
    data: {
      caller: 'Hi, I need a ride.',
      why: "Typed as an address only, this drops the pin on the building next door, and that is exactly where a driver went once: the customer was never picked up. "
        + "Type the business name in the same address box (start with \"Men\") and pick Menchie's from the list: the pin moves about 40 m to the right storefront. "
        + 'Always add the place name the customer mentions, then check the pin on satellite and Street View. '
        + 'Whenever a pickup is not at home, ask what the customer is wearing so the driver can spot them in a busy place.',
      stops: [{
        kind: 'pickup', label: "Menchie's Frozen Yogurt",
        addressGiven: '14060 SE Petrovitsky Rd, Renton, WA 98058',
        start: { lat: 47.4460548, lng: -122.1517119 },   // what the address alone returns
        answer: { lat: 47.4460118, lng: -122.1522953 },  // what "Menchie's" returns
        entrances: [],
      }],
      questions: [
        { q: 'Where would you like to be picked up? Can you give me the address?', a: "I'm at 14060 Southeast Petrovitsky Road in Renton.", needed: true },
        { q: 'Can you spell the name of the street for me?', a: 'P-E-T-R-O-V-I-T-S-K-Y.', needed: false },
        { q: 'What is the name of the business you are at?', a: "Menchie's.", needed: true },
        { q: 'Can you spell the name of the business?', a: "M-E-N-C-H-I-E apostrophe S. It's the frozen yogurt place.", needed: false },
        { q: 'Any notes for the driver?', a: "Just tell them I'm at Menchie's.", needed: false },
        { q: 'Would you mind telling me what you are wearing, so the driver can spot you easier?', a: 'A blue top and black jeans.', needed: true },
        { q: 'Where are you going?', a: 'Home. Can we do the pickup first and I will give you the rest after?', needed: false },
      ],
      note: {
        mustMention: ['Menchie', 'blue', 'jeans'],
        model: "Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans.",
      },
    },
  },
];

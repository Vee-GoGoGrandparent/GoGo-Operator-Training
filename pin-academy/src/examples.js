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
        + 'Move the pin a little forward, in front of the entrance where a car can stop, never right on top of the building. '
        + 'Read the address back to the customer every time. '
        + 'Whenever a pickup is not at home, ask what the customer is wearing so the driver can spot them in a busy place.',
      stops: [{
        kind: 'pickup', label: "Menchie's Frozen Yogurt",
        addressGiven: '14060 SE Petrovitsky Rd, Renton, WA 98058',
        start: { lat: 47.4460548, lng: -122.1517119 },   // what the address alone returns
        answer: { lat: 47.4460118, lng: -122.1522953 },  // what "Menchie's" returns
        entrances: [],
      }],
      // In the order Vee runs the call. Must-asks: the address, reading it back, the business, what they're wearing.
      questions: [
        { q: 'Ask them to repeat the address', say: 'Perfect, I was able to pull up your account. Can you repeat the address for me?',
          a: '14060 Southeast Petrovitsky Road, in Renton.', needed: true },
        { q: 'Read the address back', say: "Okay, that's 14060 Southeast Petrovitsky Road in Renton, Washington. Is that correct?",
          a: "Yes, that's right.", needed: true },
        { q: 'Ask them to spell the street', say: 'Can you spell the street name for me?', a: 'P-E-T-R-O-V-I-T-S-K-Y.', needed: false },
        { q: 'Ask for the name of the business', say: 'Are you at a business at that address? What is the name of it?', a: "Yes, I'm at Menchie's.", needed: true },
        { q: 'Ask them to spell the business', say: "You said you're located at Menchie's. Can you spell the name of the business for me?",
          a: "M-E-N-C-H-I-E apostrophe S. It's the frozen yogurt place.", needed: false },
        { q: 'Read the business back', say: "So that's Menchie's Frozen Yogurt on Southeast Petrovitsky Road, correct?", a: 'Yes, that one.', needed: false },
        { q: 'Tell them you are checking the map', say: 'Give me just a moment while I look at the map. I want to make sure I put the pickup spot in the right place.',
          a: 'Okay, no problem.', needed: false },
        { q: 'Ask for notes for the driver', say: 'Do you have any notes for the driver?', a: "Just tell them I'm at Menchie's.", needed: false },
        { q: 'Ask what they are wearing', say: "Would you mind telling me what you're wearing, so the driver can spot you easier?", a: 'A blue top and black jeans.', needed: true },
        { q: 'Ask where they are going', say: 'And where will you be going today?', a: 'Home. Can we set up the pickup first?', needed: false },
        { q: 'Send the driver to the address', say: "Okay, I'll send the driver to that address.", a: 'Okay, thank you.', needed: false },
      ],
      note: {
        mustMention: ['Menchie', 'blue', 'jeans'],
        model: "Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans.",
      },
    },
  },
];

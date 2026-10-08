// Worked examples from real training cases Vee uses. Public places only; customer details are made up.
// Admins add them from the Scenarios page ("Add / refresh the examples"). Coordinates are Vee's, from the dashboard.
// The caller only says what they want; the trainee gets the rest by asking, the way a real call goes.

// Every call: right after the name, confirm the best contact number (Vee, 2026-10-07). The number is GoGo's own
// toll-free line, standing in for the customer's phone in this practice copy.
export const CONTACT_LINE = { q: 'Confirm the best contact number', say: 'And is this still the best contact number for you, 855-464-6872?',
  a: "Yes, that's the best number.", needed: true };

export const CONFIRM_NAME_LINE = { q: "Confirm the customer's name", say: 'Perfect, I was able to pull up your account. Am I speaking with Marge Simpson?',
  a: 'Yes, this is Marge.', needed: true };

// The call in steps (Vee, 2026-10-07): each step shows the right line plus two that sound right but are not next.
// Vee's order (afternoon): mention the saved location ("dropped off here earlier"), the business, the map, go there
// often ("every Sunday"), save it as preferred location #3, where to (home), confirm the home address, clothing, notes.
// Admins change it in the scenario editor. Lines are named by their button.
// Branches (Vee, 2026-10-08): step 3 can be "repeat the address" OR "mention the saved location". If they asked for
// the address, they mention the saved location next and ask the business name the usual way; if they mentioned the
// saved location first, they read the address back and ask "you're at a business there, correct?". Both paths meet
// at "checking the map" / "go there often": both right, ONE wording (so they learn the words, not just the button).
export const MENCHIES_MAP_OFTEN = { say: "Give me just a moment while I look at the map. I want to make sure I put the pickup spot in the right place. By the way, is Menchie's a place you go to often?",
  a: 'Yes, I go every Sunday.' };
export const MENCHIES_BUSINESS_SAVED = { q: "Ask the business name (it's saved)", say: "I see we have that address saved on your account. You're at a business there, correct? Can you tell me the name of the place?",
  a: "Yes, I'm at Menchie's, the frozen yogurt place.", needed: true };
export const MENCHIES_STEPS = [
  { right: ["Confirm the customer's name"], wrong: ['Ask them to repeat the address', 'Mention the saved location'] },
  { right: ['Confirm the best contact number'], wrong: ['Ask them to repeat the address', 'Mention the saved location'] },
  { right: ['Ask them to repeat the address', 'Mention the saved location'], wrong: ['Ask them to spell the street'] },
  { right: ['Read the address back'], wrong: ['Ask them to spell the street', 'Send the driver to the address'] },
  { right: ['Mention the saved location'], wrong: ['Send the driver to the address', 'Ask what they are wearing'], when: { notSaid: 'Mention the saved location' } },
  { right: ['Ask for the name of the business'], wrong: ['Ask them to spell the street', 'Ask for notes for the driver'], when: { said: 'Ask them to repeat the address' } },
  { right: [MENCHIES_BUSINESS_SAVED.q], wrong: ['Ask them to spell the street', 'Ask for notes for the driver'], when: { notSaid: 'Ask them to repeat the address' } },
  { right: ['Tell them you are checking the map', 'Ask if they go there often'], wrong: ['Ask for notes for the driver'], ...MENCHIES_MAP_OFTEN },
  { right: ['Save it as their preferred location'], wrong: ['Send the driver to the address', 'Provide estimate'] },
  { right: ['Ask where they are going'], wrong: ['Provide estimate', 'Ask what they are wearing'] },
  { right: ['Confirm the home address'], wrong: ['Ask what they are wearing', 'Provide estimate'] },
  { right: ['Ask what they are wearing'], wrong: ['Ask for notes for the driver', 'Provide estimate'] },
  { right: ['Ask for notes for the driver'], wrong: ['Provide estimate', 'Send the driver to the address'] },
  { right: ['Provide estimate'], wrong: ['Provide driver info', 'Ask if there is anything else'] },
  { right: ['Provide driver info'], wrong: ['Ask if there is anything else', 'Close the call'] },
  { right: ['Ask if there is anything else'], wrong: ['Close the call', 'Send the driver to the address'] },
  { right: ['Close the call'], wrong: ['Send the driver to the address', 'Ask them to spell the business'] },
];

// The two lines Vee added to Menchie's (2026-10-07), and the driver note choices for practice.
export const MENCHIES_NEW_LINES = [
  { q: 'Save it as their preferred location', say: "Okay, I'm going to go ahead and save this on your account as your preferred location number three. That way it's easier for you when it's time to order rides to or from here.",
    a: "Oh, that's great, thank you!", needed: true },
  { q: 'Confirm the home address', say: 'Will we be taking you home to 17130 127th Avenue Southeast, Renton, Washington 98058?', a: "Yes, that's right.", needed: true },
];
export const MENCHIES_ANSWERS = {
  'Mention the saved location': 'Oh yes, I was just dropped off here earlier.',
  'Ask if they go there often': 'Yes, I go every Sunday.',
  'Ask where they are going': 'Home.',
};
export const MENCHIES_NOTE_OPTIONS = [
  { text: "Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans.", right: true },
  { text: "🚪 Menchie's ☎️ Call customer upon arrival", right: false },
  { text: 'Customer is at 14060 Southeast Petrovitsky Road. Please call her when you arrive.', right: false },
];
export const TORIKAYA_NOTE_OPTIONS = [
  { text: 'Two passengers. The female rider uses a walker, please assist her. Please drop them off at Torikaya, the restaurant at 1120 Houston Street.', right: true },
  { text: 'Please drop the customers off at Torikaya, the restaurant at 1120 Houston Street.', right: false },
  { text: 'Two passengers, one with a walker. Drop off at 1120 Houston Street.', right: false },
];


// Turn named steps into line numbers. A step whose right line is not in the list is skipped; missing wrong lines are dropped.
export function stepsFromNames(questions, named) {
  const at = (name) => questions.findIndex((q) => q.q.trim().toLowerCase() === name.toLowerCase());
  return named.map((st) => {
    const right = st.right.map(at).filter((i) => i >= 0);
    const wrong = st.wrong.map(at).filter((i) => i >= 0 && !right.includes(i));
    const out = { choices: [...right, ...wrong], right };
    // A branch: only if a line was (or was not) said earlier. A shared wording: one line for all the right answers.
    const w = st.when?.said ? at(st.when.said) : st.when?.notSaid ? at(st.when.notSaid) : -1;
    if (w >= 0) out.when = st.when.said ? { said: w } : { notSaid: w };
    if (st.say && right.length > 1) { out.say = st.say; out.a = st.a || ''; }
    return out;
  }).filter((st) => st.right.length);
}

export const EXAMPLE_SCENARIOS = [
  {
    title: "Menchie's on Petrovitsky Road",
    category: 'Place or business name',
    data: {
      caller: "Hi, I'd like to be picked up at 14060 Southeast Petrovitsky Road.",
      why: "Typed as an address only, this drops the pin on the building next door, and that is exactly where a driver went once: the customer was never picked up. "
        + "Type the business name in the same address box (start with \"Men\") and pick Menchie's from the list: the pin moves about 40 m to the right storefront. "
        + 'Always add the place name the customer mentions, then check the pin on satellite and Street View. '
        + 'Move the pin a little forward, in front of the entrance where a car can stop, never right on top of the building. '
        + 'Read the address back to the customer every time. '
        + 'Custom Location #3 on this account was saved by the system after an earlier ride, with the pin in the wrong spot. '
        + 'Never trust a saved location blindly: check its pin, fix it, and since she goes there often, save the corrected pin over #3 '
        + '(if she did not go there often, delete it instead). '
        + 'Whenever a pickup is not at home, ask what the customer is wearing so the driver can spot them in a busy place.',
      // The system saved this stop after an earlier ride, with the wrong coordinates (Vee's real example).
      account: {
        home: { label: 'Home', address: '17130 127th Avenue Southeast, Renton, WA 98058', lat: 47.44892956, lng: -122.1726835 },
        saved: [{ label: '14060 SE Petrovitsky Rd', address: '14060 Southeast Petrovitsky Road, Renton, WA 98058', lat: 47.44598587, lng: -122.15203913 }],
      },
      savedFix: { slot: 3, action: 'update', stop: 'pickup' },
      stops: [{
        kind: 'pickup', label: "Menchie's Frozen Yogurt",
        addressGiven: '14060 SE Petrovitsky Rd, Renton, WA 98058',
        start: { lat: 47.4460548, lng: -122.1517119 },   // what the address alone returns
        answer: { lat: 47.4460118, lng: -122.1522953 },  // what "Menchie's" returns
        entrances: [],
      }, {
        // She is going home: the Home saved on the account (the ⌂ button) has the right coordinates.
        kind: 'dropoff', label: 'Home', addressGiven: '17130 127th Avenue Southeast, Renton, WA 98058',
        start: { lat: 47.44892956, lng: -122.1726835 }, answer: { lat: 47.44892956, lng: -122.1726835 }, entrances: [],
      }],
      ride: { customerName: 'Marge Simpson' },
      // In the order Vee runs the call. Must-asks: the address, reading it back, the business, what they're wearing.
      questions: [
        CONFIRM_NAME_LINE,
        CONTACT_LINE,
        { q: 'Ask them to repeat the address', say: 'Thank you, Marge. Can you repeat the address for me?',
          a: '14060 Southeast Petrovitsky Road, in Renton.', needed: true },
        { q: 'Read the address back', say: "Okay, that's 14060 Southeast Petrovitsky Road in Renton, Washington. Is that correct?",
          a: "Yes, that's right.", needed: true },
        {"q":"Mention the saved location","say":"Okay, looks like we have this location saved on your account.","a":"Oh yes, I was just dropped off here earlier.","needed":true},
        { q: 'Ask them to spell the street', say: 'Can you spell the street name for me?', a: 'P-E-T-R-O-V-I-T-S-K-Y.', needed: false },
        { q: 'Ask for the name of the business', say: 'Are you at a business at that address? What is the name of it?', a: "Yes, I'm at Menchie's.", needed: true },
        MENCHIES_BUSINESS_SAVED,
        { q: 'Ask them to spell the business', say: "You said you're located at Menchie's. Can you spell the name of the business for me?",
          a: "M-E-N-C-H-I-E apostrophe S. It's the frozen yogurt place.", needed: false },
        { q: 'Read the business back', say: "So that's Menchie's Frozen Yogurt on Southeast Petrovitsky Road, correct?", a: 'Yes, that one.', needed: false },
        { q: 'Tell them you are checking the map', say: 'Give me just a moment while I look at the map. I want to make sure I put the pickup spot in the right place.',
          a: 'Okay, no problem.', needed: false },
        { q: 'Ask if they go there often', say: "Is Menchie's a place you go to often?",
          a: 'Yes, I go every Sunday.', needed: true },
        { q: 'Ask for notes for the driver', say: 'Do you have any notes for the driver?', a: "Just tell them I'm at Menchie's.", needed: false },
        { q: 'Ask what they are wearing', say: "Would you mind telling me what you're wearing, so the driver can spot you easier?", a: 'A blue top and black jeans.', needed: true },
        { q: 'Ask where they are going', say: 'And where will we be taking you today?', a: 'Home.', needed: true },
        ...MENCHIES_NEW_LINES,
        { q: 'Send the driver to the address', say: "Okay, I'll send the driver to that address.", a: 'Okay, thank you.', needed: false },
        { q: 'Provide estimate', say: 'Okay, looks like this trip is going to cost you between $8-$10. Is it ok if I go ahead and order this ride for you now?',
          a: 'Yes, please.', needed: true },
        { q: 'Provide driver info', say: "We were able to find you a driver. Looks like Lidong, in a black Toyota Sienna, last 4 digits 0734, should be arriving in about 2 minutes. If you don't see the driver within that time, please give us a call back immediately so we can look into the status of your ride.",
          a: 'Okay, thank you.', needed: true },
        {"q":"Ask if there is anything else","say":"Is there anything else I can help you with today?","a":"No, that's all. Thank you!","needed":true},
        {"q":"Close the call","say":"Perfect! Thank you so much for calling GoGo, and we hope you have a beautiful and wonderful day.","a":"You too, bye!","needed":true},
      ],
      note: {
        mustMention: ['Menchie', 'blue', 'jeans'],
        model: "Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans.",
        options: MENCHIES_NOTE_OPTIONS,
      },
    },
  },
  {
    // Vee, 2026-10-07: a real complaint. The caller named the restaurant at the start, the operator typed only the
    // address and never picked Torikaya from the list, and the couple were almost dropped at the wrong place (71 m off).
    // Also an empathy check: they say it is their anniversary, and moving on without acknowledging it fails the call.
    // Coordinates are Vee's from the dashboard. Customer name is made up.
    title: 'Anniversary dinner on Houston Street',
    category: 'Place or business name',
    data: {
      caller: 'Hi, this is Rick. My wife and I need a ride from home to Torikaya on Houston Street.',
      why: 'The caller said the name of the restaurant right at the start. Typed as an address only, 1120 Houston Street puts the drop-off pin about 70 m away, '
        + 'which is where the operator left it on the real call, and the couple were almost dropped off at the wrong place. '
        + 'After you type the address, ask for the name of the place again, then type the restaurant name in the End Address box (start with "Tori"), '
        + 'pick Torikaya from the list, and check the pin on satellite and Street View. The drop-off pin matters as much as the pickup. '
        + 'Home is saved on the account (the ⌂ button): confirm the full home address with the customer. '
        + 'Listen to the customer: the moment they mention their anniversary, congratulate them right then, and keep celebrating with them while you work (forty years!). '
        + 'A call that moves on without it does not pass, even with the right pin. '
        + 'Always ask if they have notes for the driver: here his wife uses a walker, and the driver needs to know.',
      account: {
        home: { label: 'Home', address: '7301 East Brainerd Road, Chattanooga, TN 37421', lat: 35.0170514, lng: -85.1643452 },
        saved: [],
      },
      stops: [{
        kind: 'pickup', label: 'Home', addressGiven: '7301 East Brainerd Road, Chattanooga, TN 37421',
        start: { lat: 35.0170514, lng: -85.1643452 }, answer: { lat: 35.0170514, lng: -85.1643452 }, entrances: [],
      }, {
        kind: 'dropoff', label: 'Torikaya', addressGiven: '1120 Houston Street, Chattanooga, TN 37402',
        start: { lat: 35.0427, lng: -85.3060933 },                      // where the operator left it (address only)
        answer: { lat: 35.04246931201211, lng: -85.30682293621099 },    // Torikaya
        entrances: [],
      }],
      ride: {
        customerName: 'Rick Sanchez', rideType: 'UberX', eta: '5-10 min(s)', trip: 'A 20 minute(s) trip over 9 for $23 ~ $25',
        surge: '1', perMile: '$ 0.48', perMinute: '$ 0.66', baseFare: '2.34', minFare: '6.31', cost: '$23 ~ $25',
        credits: '$67.32', expiring: 'No', autoTip: 'No',
        driver: { name: 'Yoandris', car: 'Red Mazda CX-5', plate: 'AWYY', eta: '10 minutes' },
      },
      questions: [
        { q: "Confirm the customer's name", say: 'Perfect, I was able to pull up your account. Am I speaking with Rick Sanchez?', a: 'Yes, this is Rick.', needed: true },
        CONTACT_LINE,
        { q: 'Ask for the pickup address', say: 'Okay. What address will we be picking you up from?', a: "From home. Isn't that on my account?", needed: false },
        { q: 'Confirm the pickup is home', say: 'Will we be picking you up from your home at 7301 East Brainerd Road, Chattanooga, Tennessee 37421?', a: 'Yes, from home.', needed: true },
        { q: 'Ask for the drop-off address', say: 'Perfect. And where will we be taking you today? Can you give me the address?', a: "It's 1120 Houston Street, in Chattanooga.", needed: true },
        { q: 'Read the address back', say: "Okay, that's 1120 Houston Street in Chattanooga, Tennessee. Is that correct?", a: "Yes, that's right.", needed: true },
        { q: 'Ask them to spell the street', say: 'Can you spell the street name for me?', a: 'H-O-U-S-T-O-N.', needed: false },
        { q: 'Ask for the name of the place', say: 'Perfect, I was able to add the address to our system. Can you tell me again the name of the place you are heading to?',
          a: "Yes, it's Torikaya. It's a restaurant. We're going there for our anniversary tonight!", needed: true },
        { q: 'Congratulate them on their anniversary', say: 'Oh, happy anniversary! Congratulations to you both. How long have you been married?',
          a: 'Thank you! Forty years today.', needed: true },
        { q: 'Celebrate with them while you check the map', say: "Wow, forty years, that's incredible! You two have worked so hard to keep your marriage strong. I'm looking over the map right now to make sure we drop you off at the right spot for your 40th anniversary dinner.",
          a: "Thank you, that's very kind of you.", needed: true },
        { q: 'Tell them you are checking the map', say: 'Give me just a moment while I look at the map. I want to make sure the driver drops you off right at the restaurant.',
          a: 'Sure, take your time.', needed: false },
        { q: 'Ask what they are wearing', say: "Would you mind telling me what you're wearing, so the driver can spot you easier?", a: "We'll be right outside the house, the driver will see us.", needed: false },
        { q: 'Send the driver to the address', say: "Okay, I'll send the driver to that address.", a: 'Okay, thank you.', needed: false },
        { q: 'Ask for notes for the driver', say: 'Do you have any notes for the driver?', a: 'Yes, my wife uses a walker.', needed: true },
        { q: 'Provide estimate', say: 'Okay, looks like this trip is going to cost you between $23-$25. Is it ok if I go ahead and order this ride for you now?', a: 'Yes, please, go ahead and order it.', needed: true },
        { q: 'Provide driver info', say: "We were able to find you a driver. Looks like Yoandris, in a red Mazda CX-5, license plate AWYY, should be arriving in about 10 minutes. If you don't see the driver within that time, please give us a call back immediately so we can look into the status of your ride.",
          a: 'Perfect, thank you.', needed: true },
        { q: 'Ask if there is anything else', say: 'Is there anything else I can help you with today?', a: "No, that's everything.", needed: true },
        { q: 'Close with an anniversary wish', say: 'Perfect! Thank you so much for calling GoGo. Enjoy your dinner, and happy anniversary to you both!', a: 'Thank you so much! Bye!', needed: false },
        { q: 'Close the call', say: 'Perfect! Thank you so much for calling GoGo, and we hope you have a beautiful and wonderful day.', a: 'You too, bye!', needed: false },
      ],
      note: {
        mustMention: ['Torikaya', 'walker'],
        model: 'Two passengers. The female rider uses a walker, please assist her. Please drop them off at Torikaya, the restaurant at 1120 Houston Street.',
        options: TORIKAYA_NOTE_OPTIONS,
      },
    },
  },
];
EXAMPLE_SCENARIOS[0].data.steps = stepsFromNames(EXAMPLE_SCENARIOS[0].data.questions, MENCHIES_STEPS);

// Torikaya's call (Vee, 2026-10-07 v2): confirm the full home address; after the drop-off address, ask for the name of
// the place again, which is when the anniversary comes up: congratulate right then, and keep celebrating while checking
// the map (the plain map line is wrong there). Always ask for driver notes. Close with an anniversary wish (Vee:
// the plain close is wrong here).
export const TORIKAYA_STEPS = [
  { right: ["Confirm the customer's name"], wrong: ['Ask for the pickup address', 'Ask for the drop-off address'] },
  { right: ['Confirm the best contact number'], wrong: ['Ask for the pickup address', 'Confirm the pickup is home'] },
  { right: ['Confirm the pickup is home'], wrong: ['Ask for the pickup address', 'Ask what they are wearing'] },
  { right: ['Ask for the drop-off address'], wrong: ['Ask what they are wearing', 'Send the driver to the address'] },
  { right: ['Read the address back'], wrong: ['Ask them to spell the street', 'Send the driver to the address'] },
  { right: ['Ask for the name of the place'], wrong: ['Ask them to spell the street', 'Provide estimate'] },
  // The caller just said it's their anniversary: congratulate them right away. Moving on is wrong.
  { right: ['Congratulate them on their anniversary'], wrong: ['Tell them you are checking the map', 'Provide estimate'] },
  // Forty years: keep celebrating while you work. The plain map line is wrong here.
  { right: ['Celebrate with them while you check the map'], wrong: ['Tell them you are checking the map', 'Send the driver to the address'] },
  { right: ['Ask for notes for the driver'], wrong: ['Provide estimate', 'Send the driver to the address'] },
  { right: ['Provide estimate'], wrong: ['Provide driver info', 'Ask if there is anything else'] },
  { right: ['Provide driver info'], wrong: ['Ask if there is anything else', 'Close the call'] },
  { right: ['Ask if there is anything else'], wrong: ['Close the call', 'Close with an anniversary wish'] },
  { right: ['Close with an anniversary wish'], wrong: ['Close the call', 'Send the driver to the address'] },
];
EXAMPLE_SCENARIOS[1].data.steps = stepsFromNames(EXAMPLE_SCENARIOS[1].data.questions, TORIKAYA_STEPS);

const ADJECTIVES = [
  'Swift', 'Cosmic', 'Neon', 'Crystal', 'Amber', 'Jade', 'Lunar', 'Solar',
  'Frost', 'Storm', 'Ember', 'Coral', 'Onyx', 'Opal', 'Ruby', 'Sage',
  'Misty', 'Golden', 'Silver', 'Iron', 'Velvet', 'Crimson', 'Azure', 'Ivory',
];

const NOUNS = [
  'Falcon', 'Phoenix', 'Tiger', 'Panda', 'Orca', 'Lynx', 'Hawk', 'Wolf',
  'Fox', 'Bear', 'Eagle', 'Raven', 'Viper', 'Dragon', 'Cobra', 'Panther',
  'Dolphin', 'Jaguar', 'Owl', 'Lion', 'Shark', 'Crane', 'Bison', 'Elk',
];

export function randomWalletName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

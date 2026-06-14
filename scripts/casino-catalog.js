/** Casino game catalog — mirrors 22yards frontend (184 games) */
module.exports = [
  ...['20-20 TEENPATTI', '1DAY TEEN PATTI', 'JOKER TEEN PATTI', 'MUFLIS TEEN PATTI',
    '20-20 DRAGON TIGER', '1 DAY DRAGON TIGER', 'DRAGON TIGER', 'ANDAR BAHAR',
    'BACCARAT', 'POKER', 'LUCKY 7', '32 CARDS', 'DTL', 'CARD RACE', 'AMAR AKBAR ANTHONY',
  ].map((name) => ({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), category: 'universe-live', minBet: 100, maxBet: 500000 })),
  ...[
    { name: 'VIMAAN', category: 'universe-crash' },
    { name: 'BALLOON', category: 'universe-instant' },
    { name: 'HEADS & TAILS', category: 'universe-instant' },
    { name: 'LUCKY 0 TO 9', category: 'universe-instant' },
  ].map((g) => ({ ...g, slug: g.name.toLowerCase().replace(/\s+/g, '-'), minBet: 10, maxBet: 100000 })),
  ...['Evolution Top Games', 'Evolution Dragon Tiger', 'Evolution Baccarat', 'Evolution Roulette',
    'Evolution Blackjack', 'Ezugi Baccarat', 'Ezugi Blackjack', 'Ezugi Roulette',
  ].map((name) => ({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), category: 'international', minBet: 50, maxBet: 500000 })),
  ...`50 Galaxy Stones,80s Retro Spin,Ages Of Wild,Antique Fortune,Arabian Legacy,Arcane Infinity,Book Of Amon,Book Of Deep,Book Of Samurai,Dragon Hunter,Elixir Of Fortune,Fat Fish,Fire Gems,Fruit Charm,Gladiator,Gold Of Goblin,Hot Fruits 5,Lucky Gold Strike,Mega Diamond Fortune,Rise Of Mafia,Sugar Pop Bonanza,Sweet 7s,Thunder 777,Wild Cocktail,Zeuss War`.split(',').map((name) => ({
    name: name.trim(),
    slug: name.trim().toLowerCase().replace(/\s+/g, '-'),
    category: 'slots',
    minBet: 10,
    maxBet: 50000,
  })),
];

// Static game content: unit types, operations, bases, factions, crisis types.
// Speeds in km per game-hour. One game-hour = one real second at 1x.

export const CLASSES = {
  air: { label: 'AIR', icon: '✈' },
  naval: { label: 'NAVAL', icon: '⚓' },
  ground: { label: 'GROUND', icon: '▲' },
  cyber: { label: 'CYBER', icon: '⌁' },
  space: { label: 'SPACE', icon: '✦' },
};

export const UNIT_TYPES = {
  fighter: { name: 'F-35 Squadron', short: 'F-35', cls: 'air', model: 'fighter', size: 0.022, speed: 1900, alt: 0.028,
    air: 9, strike: 3, stealth: 0.55, ground: 0, rearm: 5, cost: 0.4, icon: '✈',
    blurb: 'Air superiority. Flies cover, escorts strikes, intercepts.' },
  bomber: { name: 'B-2 Spirit Wing', short: 'B-2', cls: 'air', model: 'bomber', size: 0.03, speed: 1000, alt: 0.034,
    air: 0, strike: 11, stealth: 0.85, ground: 0, rearm: 16, cost: 1.6, icon: '◭',
    blurb: 'Stealth heavy strike. Flattens hardened targets from anywhere.' },
  drone: { name: 'MQ-9 Reaper Flight', short: 'MQ-9', cls: 'air', model: 'drone', size: 0.022, speed: 420, alt: 0.022,
    air: 0, strike: 3.5, stealth: 0.2, ground: 0, rearm: 3, cost: 0.08, icon: '⟡', recon: 35,
    blurb: 'Persistent surveillance and surgical strikes. Low collateral.' },
  sof: { name: 'Special Operations Team', short: 'SOF', cls: 'air', model: 'helicopter', size: 0.022, speed: 320, alt: 0.012,
    air: 0, strike: 2, raid: 10, stealth: 0.45, ground: 2, rearm: 10, cost: 0.3, icon: '✠',
    blurb: 'Night raids, hostage rescue, high-value captures.' },
  airborne: { name: 'Airborne Battalion', short: 'ABN', cls: 'ground', model: 'transport', groundModel: 'tank', size: 0.03, speed: 800, alt: 0.03,
    air: 0, strike: 0, ground: 6, stealth: 0.1, rearm: 8, cost: 0.6, icon: '⛉', aid: true,
    blurb: 'Rapid deployment anywhere in 18 hours. Holds ground, delivers aid.' },
  armor: { name: 'Armored Battalion', short: 'ARM', cls: 'ground', model: 'transport', groundModel: 'tank', size: 0.03, speed: 560, alt: 0.03,
    air: 0, strike: 0, ground: 11, stealth: 0.05, rearm: 12, cost: 1.0, icon: '▣',
    blurb: 'Heavy armor. Slow to deploy, unstoppable once there.' },
  carrier: { name: 'Carrier Strike Group', short: 'CSG', cls: 'naval', model: 'carrier', size: 0.045, speed: 60,
    air: 7, strike: 5, defense: 6, naval: 8, stealth: 0.0, rearm: 6, cost: 0.8, icon: '⛴', range: 2600,
    blurb: 'A floating air base. Projects air power and shields allies.' },
  destroyer: { name: 'Destroyer Squadron', short: 'DDG', cls: 'naval', model: 'destroyer', size: 0.03, speed: 65,
    air: 2, strike: 4, defense: 9, naval: 6, stealth: 0.1, rearm: 6, cost: 0.4, icon: '⛵', range: 2500,
    blurb: 'Aegis missile defense and Tomahawk cruise missiles.' },
  submarine: { name: 'Attack Submarine', short: 'SSN', cls: 'naval', model: 'submarine', size: 0.028, speed: 50,
    air: 0, strike: 5, defense: 0, naval: 10, stealth: 0.92, rearm: 8, cost: 0.4, icon: '◒', range: 2500,
    blurb: 'Invisible. Sinks fleets and fires cruise missiles undetected.' },
  cyber: { name: 'Cyber Mission Team', short: 'CMT', cls: 'cyber', model: null, speed: 0,
    air: 0, strike: 0, cyber: 8, rearm: 10, cost: 0.15, icon: '⌁', recon: 25,
    blurb: 'Blinds air defenses, cripples grids, hunts hackers.' },
  satellite: { name: 'Recon Constellation', short: 'SAT', cls: 'space', model: 'satellite', size: 0.03, speed: 0,
    rearm: 6, cost: 0.1, icon: '✦', recon: 50,
    blurb: 'Eyes everywhere. Reveals hidden sites and cells.' },
  orbital: { name: 'Orbital Strike Platform', short: 'ROD', cls: 'space', model: 'satellite', size: 0.034, speed: 0,
    strike: 16, rearm: 60, cost: 3.0, icon: '☄', stealth: 1,
    blurb: 'Tungsten rods from orbit. Unstoppable. Unforgettable.' },
};

// Operations: esc = escalation tier (0 benign ... 4 war). `uses` = unit types that can perform it.
export const OPS = {
  recon: { name: 'Recon', esc: 0, uses: ['satellite', 'drone', 'cyber', 'submarine'], target: 'country',
    desc: 'Gather intel. Reveals sites and hidden cells.' },
  aid: { name: 'Humanitarian Aid', esc: -1, uses: ['airborne'], target: 'country',
    desc: 'Deliver relief. Lowers tension, wins hearts.' },
  patrol: { name: 'Patrol / Defend', esc: 1, uses: ['fighter', 'carrier', 'destroyer', 'submarine', 'airborne', 'armor'], target: 'country',
    desc: 'Station forces. Shields against missiles, invasions and pirates.' },
  cyber_ad: { name: 'Cyber: Blind Air Defense', esc: 1, uses: ['cyber'], target: 'country',
    desc: 'Disable their SAM network for 24h.' },
  strike: { name: 'Precision Strike', esc: 2, uses: ['drone', 'fighter', 'bomber', 'submarine', 'destroyer', 'carrier', 'orbital'], target: 'site',
    desc: 'Destroy one target. Pick a site.' },
  raid: { name: 'Special Ops Raid', esc: 2, uses: ['sof'], target: 'site',
    desc: 'Capture, rescue or eliminate. Minimal collateral.' },
  cyber_grid: { name: 'Cyber: Grid Blackout', esc: 2, uses: ['cyber'], target: 'country',
    desc: 'Cripple their military logistics and economy.' },
  blockade: { name: 'Naval Blockade', esc: 2, uses: ['carrier', 'destroyer', 'submarine'], target: 'country', coastal: true,
    desc: 'Choke their trade. Military strength bleeds daily.' },
  campaign: { name: 'Air Campaign', esc: 3, uses: ['bomber', 'fighter', 'drone', 'carrier'], target: 'country',
    desc: 'Sustained bombing of every known site.' },
  invade: { name: 'Ground Invasion', esc: 4, uses: ['airborne', 'armor'], target: 'country',
    desc: 'Put boots on the ground and take control.' },
};

export const SITE_TYPES = {
  ad: { name: 'SAM Network', model: 'sam', hp: 100, hard: 0.4, stat: 'ad' },
  air: { name: 'Air Base', model: 'base', hp: 120, hard: 0.5, stat: 'air' },
  navy: { name: 'Naval Base', model: 'base', hp: 120, hard: 0.5, stat: 'navy' },
  missile: { name: 'Missile Battery', model: 'sam', hp: 90, hard: 0.6, stat: 'missiles' },
  hq: { name: 'Command HQ', model: 'base', hp: 150, hard: 0.8, stat: 'mil' },
  cell: { name: 'Terror Cell', model: null, hp: 40, hard: 0.1, hidden: 45 },
  camp: { name: 'Training Camp', model: null, hp: 70, hard: 0.2, hidden: 30 },
  pirate: { name: 'Pirate Haven', model: null, hp: 60, hard: 0.2, hidden: 20 },
  server: { name: 'Hacker Server Farm', model: null, hp: 50, hard: 0.3, hidden: 40, cyberOnly: true },
  hostage: { name: 'Hostage Compound', model: null, hp: 30, hard: 0.1, hidden: 0, raidOnly: true },
  launcher: { name: 'Mobile ICBM Launcher', model: 'sam', hp: 60, hard: 0.3, hidden: 35 },
};

export const BASES = [
  { id: 'norfolk', name: 'Norfolk', ll: [-76.3, 36.95], kind: 'naval' },
  { id: 'sandiego', name: 'San Diego', ll: [-117.2, 32.7], kind: 'naval' },
  { id: 'pearl', name: 'Pearl Harbor', ll: [-157.95, 21.35], kind: 'naval' },
  { id: 'yokosuka', name: 'Yokosuka', ll: [139.67, 35.29], kind: 'naval' },
  { id: 'bahrain', name: 'Bahrain', ll: [50.6, 26.2], kind: 'naval' },
  { id: 'rota', name: 'Rota', ll: [-6.35, 36.62], kind: 'naval' },
  { id: 'guam', name: 'Guam', ll: [144.8, 13.48], kind: 'air' },
  { id: 'diego', name: 'Diego Garcia', ll: [72.42, -7.31], kind: 'air' },
  { id: 'whiteman', name: 'Whiteman AFB', ll: [-93.55, 38.73], kind: 'air' },
  { id: 'nellis', name: 'Nellis AFB', ll: [-115.03, 36.24], kind: 'air' },
  { id: 'ramstein', name: 'Ramstein', ll: [7.6, 49.44], kind: 'air' },
  { id: 'kadena', name: 'Kadena', ll: [127.77, 26.35], kind: 'air' },
  { id: 'udeid', name: 'Al Udeid', ll: [51.31, 25.12], kind: 'air' },
  { id: 'liberty', name: 'Fort Liberty', ll: [-79.0, 35.14], kind: 'army' },
  { id: 'cavazos', name: 'Fort Cavazos', ll: [-97.78, 31.13], kind: 'army' },
  { id: 'humphreys', name: 'Camp Humphreys', ll: [127.03, 36.96], kind: 'army' },
  { id: 'meade', name: 'Fort Meade', ll: [-76.74, 39.1], kind: 'cyber' },
  { id: 'schriever', name: 'Schriever SFB', ll: [-104.53, 38.8], kind: 'space' },
];

// [type, base, callsign]; naval units start at sea near their base.
export const ROSTER = [
  ['fighter', 'nellis', 'VIPER'], ['fighter', 'ramstein', 'SABRE'], ['fighter', 'kadena', 'RAPTOR'], ['fighter', 'udeid', 'TALON'],
  ['bomber', 'whiteman', 'SPIRIT'], ['bomber', 'diego', 'SHADOW'],
  ['drone', 'nellis', 'REAPER-1'], ['drone', 'udeid', 'REAPER-2'], ['drone', 'ramstein', 'REAPER-3'],
  ['sof', 'liberty', 'DELTA'], ['sof', 'ramstein', 'TRIDENT'],
  ['airborne', 'liberty', '82ND'], ['airborne', 'humphreys', '173RD'],
  ['armor', 'cavazos', 'IRONHORSE'], ['armor', 'ramstein', 'BLACKJACK'],
  ['carrier', 'sandiego', 'CVN-74'], ['carrier', 'norfolk', 'CVN-77'], ['carrier', 'yokosuka', 'CVN-76'],
  ['destroyer', 'bahrain', 'DESRON-50'], ['destroyer', 'rota', 'DESRON-60'], ['destroyer', 'yokosuka', 'DESRON-15'],
  ['submarine', 'pearl', 'SSN-HAWAII'], ['submarine', 'norfolk', 'SSN-VIRGINIA'],
  ['cyber', 'meade', 'CMT-ALPHA'], ['cyber', 'meade', 'CMT-BRAVO'],
  ['satellite', 'schriever', 'KEYHOLE-A'], ['satellite', 'schriever', 'KEYHOLE-B'],
  ['orbital', 'schriever', 'THOR'],
];

export const SANDBOX_EXTRA = [
  ['fighter', 'guam', 'WARHAWK'], ['fighter', 'nellis', 'GHOST'], ['bomber', 'guam', 'NIGHTHAWK'],
  ['drone', 'kadena', 'REAPER-4'], ['sof', 'udeid', 'GREEN BERETS'], ['armor', 'humphreys', 'WARRIORS'],
  ['carrier', 'rota', 'CVN-78'], ['destroyer', 'pearl', 'DESRON-31'], ['submarine', 'yokosuka', 'SSN-TOKYO'],
  ['cyber', 'meade', 'CMT-CHARLIE'], ['orbital', 'schriever', 'ZEUS'],
];

// Fictional non-state actors (no real-world organizations).
export const FACTIONS = [
  { id: 'lotus', name: 'Black Lotus', kind: 'terror network', color: '#d85cff', sites: ['cell', 'cell', 'camp'] },
  { id: 'tide', name: 'Red Tide', kind: 'pirate armada', color: '#ff7a3d', sites: ['pirate'], coastal: true },
  { id: 'null', name: 'Null Sector', kind: 'cyber syndicate', color: '#3dffc5', sites: ['server'] },
  { id: 'veil', name: 'Iron Veil', kind: 'mercenary cartel', color: '#ffd23d', sites: ['camp', 'cell'] },
];

export const CRISES = {
  plot: { title: 'Terror Plot', hours: 84, reward: 70, penalty: { approval: -9, score: -60 },
    hint: 'Recon to locate the cell, then strike or raid it.' },
  hostage: { title: 'Hostage Crisis', hours: 54, reward: 110, penalty: { approval: -12, score: -80 },
    hint: 'Send a Special Ops raid on the compound. Strikes will kill the hostages.' },
  missile: { title: 'Missile Launch Imminent', hours: 40, reward: 80, penalty: { approval: -8, score: -50 },
    hint: 'Destroy the launcher — or park destroyers near the target to intercept.' },
  pirates: { title: 'Piracy Surge', hours: 100, reward: 50, penalty: { approval: -4, score: -30 },
    hint: 'Station a warship off their coast, or strike the pirate haven.' },
  cyber: { title: 'Cyber Assault on US Grid', hours: 30, reward: 60, penalty: { approval: -7, score: -45 },
    hint: 'Cyber team: run Recon to find the server farm, then hit it.' },
  invasion: { title: 'Ally Under Attack', hours: 110, reward: 120, penalty: { approval: -15, score: -120 },
    hint: 'Patrol the ally with fighters, ships and battalions — or break the aggressor.' },
  disaster: { title: 'Humanitarian Disaster', hours: 80, reward: 60, penalty: { approval: -3, score: -20 },
    hint: 'Send an Airborne battalion with Humanitarian Aid.' },
  rivalfleet: { title: 'Rival Fleet Incursion', hours: 70, reward: 50, penalty: { tension: 10, score: -30 },
    hint: 'Show of force: patrol the ally with a carrier or destroyers.' },
};

export const STANCE_STYLE = {
  home: { fill: '#22486b', border: 'rgba(170,220,255,0.9)', label: 'HOMELAND' },
  ally: { fill: '#173e66', border: 'rgba(110,190,255,0.75)', label: 'ALLY' },
  neutral: { fill: '#1a2633', border: 'rgba(120,170,200,0.35)', label: 'NEUTRAL' },
  hostile: { fill: '#5a1820', border: 'rgba(255,110,120,0.8)', label: 'HOSTILE' },
  rival: { fill: '#5e2c10', border: 'rgba(255,160,90,0.85)', label: 'RIVAL POWER' },
  controlled: { fill: '#15503a', border: 'rgba(110,255,180,0.8)', label: 'US CONTROLLED' },
};

export const MEDALS = {
  first_blood: ['⚔', 'First Blood', 'Destroyed your first target.'],
  hearts: ['✚', 'Hearts and Minds', 'Delivered humanitarian aid.'],
  shield: ['⛨', 'Iron Umbrella', 'Intercepted an enemy missile.'],
  hostages: ['✠', 'Nobody Left Behind', 'Rescued hostages with a special-ops raid.'],
  rods: ['☄', 'Rods from God', 'Called down an orbital kinetic strike.'],
  blackout: ['⚡', 'Lights Out', 'Blacked out an enemy power grid.'],
  dismantled: ['☠', 'Network Dismantled', 'Eliminated every cell of a faction.'],
  kingmaker: ['▲', 'Kingmaker', 'Secured an entire country.'],
  crisis_master: ['★', 'Crisis Manager', 'Resolved five crises.'],
  peacemaker: ['☮', 'Peacemaker', 'Brought the world back from the brink (tension 60+ to 25).'],
  untouchable: ['◈', 'Untouchable', 'Fifteen operations without losing a unit.'],
};

export const RANKS = [
  [1400, 'S', 'Five-Star Legend'], [1000, 'A', 'Supreme Commander'], [650, 'B', 'Respected General'],
  [350, 'C', 'Adequate Steward'], [0, 'D', 'Quietly Reassigned'], [-1e9, 'F', 'Court-Martialed'],
];

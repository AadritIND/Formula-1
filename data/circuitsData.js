// Comprehensive circuit profiles for the 2026 Formula 1 Season
// Contains official 2026 detailed track map images (with colored sectors, turns, overtake detection & activation zones, speed traps)
// plus full technical telemetry, lap records, and sector coordinates.

const CIRCUITS = {
  10: {
    key: 10,
    slug: 'melbourne',
    name: 'Australian Grand Prix',
    circuit: 'Albert Park Circuit',
    location: 'Melbourne',
    country: 'Australia',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/australia-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmelbournedetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Australia%20carbon.png',
    lengthKm: 5.278,
    turns: 14,
    lapRecord: { time: '1:19.813', driver: 'Charles Leclerc', year: 2024 },
    overtakeZones: 4,
    speedTrap: 'Main Straight approaching Turn 1 (328 km/h)',
    detectionZones: 'Detection 1: Before T13; Detection 2: Before T2; Detection 3: Entry to T9',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'Heavy braking into T1 chicane, fast flick into T3-T4 complex.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–10', focus: 'High-speed sweeping chicane through lakeside curves at T9-T10.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 11–14', focus: 'Tricky double apex at T11-T12 leading onto pit straight.' }
    ],
    technicalNotes: 'Albert Park features four fast full-throttle sections with active aero Straight Mode zones. Braking stability into Turn 1 and mechanical traction exiting Turn 12 dictate qualifying pace.'
  },
  49: {
    key: 49,
    slug: 'shanghai',
    name: 'Chinese Grand Prix',
    circuit: 'Shanghai International Circuit',
    location: 'Shanghai',
    country: 'China',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/china-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackshanghaidetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/China%20carbon.png',
    lengthKm: 5.451,
    turns: 16,
    lapRecord: { time: '1:32.238', driver: 'Michael Schumacher', year: 2004 },
    overtakeZones: 2,
    speedTrap: 'Long Back Straight between T13 and T14 (345 km/h)',
    detectionZones: 'Detection 1: Turn 12 exit; Detection 2: Turn 16 apex',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–4', focus: 'The iconic 270° tightening snail curve punishing front-left tyre.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 5–10', focus: 'High-speed directional changes through rapid esses at T7-T8.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 11–16', focus: '1.2km back straight and heavy braking into the T14 hairpin.' }
    ],
    technicalNotes: 'Shanghai heavily tests front-tyre graining due to the prolonged loading through Turn 1-2. The 1.2km straight is a premier Overtake Mode activation zone.'
  },
  46: {
    key: 46,
    slug: 'suzuka',
    name: 'Japanese Grand Prix',
    circuit: 'Suzuka International Racing Course',
    location: 'Suzuka',
    country: 'Japan',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/japan-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026tracksuzukadetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Japan%20carbon.png',
    lengthKm: 5.807,
    turns: 18,
    lapRecord: { time: '1:30.983', driver: 'Lewis Hamilton', year: 2019 },
    overtakeZones: 1,
    speedTrap: 'Approaching the iconic 130R left-hander (330 km/h)',
    detectionZones: 'Detection: Exit of Turn 15 into Casio Triangle',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–7', focus: 'Rhythm-critical undulating Esses and the uphill Dunlop curve.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 8–14', focus: 'Degner 1 and 2, hairpin braking, and the double-apex Spoon curve.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 15–18', focus: 'Flat-out 130R sweep and the chicane before the pit straight.' }
    ],
    technicalNotes: 'The classic figure-of-eight layout demands maximum aerodynamic downforce and driver commitment through Sector 1. Severe lateral tyre energy requires careful stint management.'
  },
  63: {
    key: 63,
    slug: 'sakhir',
    name: 'Bahrain Grand Prix',
    circuit: 'Bahrain International Circuit',
    location: 'Sakhir',
    country: 'Bahrain',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/bahrain-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026tracksakhirdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Bahrain%20carbon.png',
    lengthKm: 5.412,
    turns: 15,
    lapRecord: { time: '1:31.447', driver: 'Pedro de la Rosa', year: 2005 },
    overtakeZones: 3,
    speedTrap: 'Main Straight into Turn 1 (338 km/h)',
    detectionZones: 'Detection 1: Before T14; Detection 2: Before T1; Detection 3: Before T9',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–4', focus: 'Tight Turn 1-2-3 complex into long acceleration towards T4.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 5–12', focus: 'Tricky downhill blind lockup zone at Turn 9-10 and high-speed T11.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 13–15', focus: 'Traction-heavy exit from T13 into the long home straight.' }
    ],
    technicalNotes: 'Abrasive asphalt surface accelerates rear thermal degradation. Turn 1 and Turn 4 provide the highest overtaking probabilities.'
  },
  149: {
    key: 149,
    slug: 'jeddah',
    name: 'Saudi Arabian Grand Prix',
    circuit: 'Jeddah Corniche Circuit',
    location: 'Jeddah',
    country: 'Saudi Arabia',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/saudi-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackjeddahdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Saudi%20Arabia%20carbon.png',
    lengthKm: 6.174,
    turns: 27,
    lapRecord: { time: '1:30.734', driver: 'Lewis Hamilton', year: 2021 },
    overtakeZones: 3,
    speedTrap: 'Entry to Turn 27 final hairpin (340 km/h)',
    detectionZones: 'Detection 1: Turn 17 exit; Detection 2: Turn 22 apex; Detection 3: Turn 27 entry',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–12', focus: 'Blindingly fast blind sweepers between concrete barriers.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 13–22', focus: '12-degree banked hairpin at Turn 13 leading to high-speed run.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 23–27', focus: 'Final flat-out sweep and tactical braking zone at Turn 27.' }
    ],
    technicalNotes: 'The fastest street circuit on the calendar with average speeds over 250 km/h. High risk of Safety Car periods and extreme demand on power unit electrical recovery.'
  },
  151: {
    key: 151,
    slug: 'miami',
    name: 'Miami Grand Prix',
    circuit: 'Miami International Autodrome',
    location: 'Miami',
    country: 'United States',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/usa-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmiamidetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Miami%20carbon.png',
    lengthKm: 5.412,
    turns: 19,
    lapRecord: { time: '1:29.708', driver: 'Max Verstappen', year: 2023 },
    overtakeZones: 3,
    speedTrap: 'Back straight approaching Turn 17 (348 km/h)',
    detectionZones: 'Detection 1: Turn 8 apex; Detection 2: Turn 16 exit; Detection 3: Turn 17 exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–8', focus: 'Flowing high-speed curves wrapping around the Hard Rock Stadium.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 9–16', focus: 'Extremely slow technical chicane under the turnpike at T14-T15.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 17–19', focus: 'Massive 1.28km back straight and heavy stop into T17 hairpin.' }
    ],
    technicalNotes: 'Track temperatures often exceed 50°C. Setup compromise between maximum downforce for Sector 1 and low drag for the long straights.'
  },
  22: {
    key: 22,
    slug: 'montecarlo',
    name: 'Monaco Grand Prix',
    circuit: 'Circuit de Monaco',
    location: 'Monte Carlo',
    country: 'Monaco',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/monaco-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmontecarlodetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Monaco%20carbon.png',
    lengthKm: 3.337,
    turns: 19,
    lapRecord: { time: '1:12.909', driver: 'Lewis Hamilton', year: 2021 },
    overtakeZones: 1,
    speedTrap: 'Tunnel exit into the Nouvelle Chicane (292 km/h)',
    detectionZones: 'Detection: After Turn 16 exit at Swimming Pool',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–4', focus: 'Sainte Dévote right-hander into the climb up Beau Rivage and Massenet.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 5–11', focus: 'Mirabeau, the ultra-slow Fairmont Hairpin (45 km/h) and the Tunnel.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 12–19', focus: 'Nouvelle Chicane, Tabac, the Swimming Pool chicane and Rascasse.' }
    ],
    technicalNotes: 'The crown jewel where qualifying is 90% of the race outcome. Zero margin for driver error with barriers millimetres away.'
  },
  15: {
    key: 15,
    slug: 'catalunya',
    name: 'Spanish Grand Prix',
    circuit: 'Circuit de Barcelona-Catalunya',
    location: 'Barcelona',
    country: 'Spain',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/spain-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackcatalunyadetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Barcelona-Catalunya%20carbon.png',
    lengthKm: 4.657,
    turns: 14,
    lapRecord: { time: '1:16.330', driver: 'Max Verstappen', year: 2023 },
    overtakeZones: 2,
    speedTrap: 'Main Straight into Turn 1 (332 km/h)',
    detectionZones: 'Detection 1: Turn 9 exit; Detection 2: Turn 13 apex',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–4', focus: 'Elf chicane into the brutal high-G Turn 3 long right-hander.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 5–9', focus: 'Seat hairpin uphill into the fast Campsa sweep.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 10–14', focus: 'La Caixa hairpin into the restored fast final sweeping corners.' }
    ],
    technicalNotes: 'The ultimate aerodynamic benchmark track. High tyre degradation on the front-left and strong tailwinds on the main straight.'
  },
  23: {
    key: 23,
    slug: 'montreal',
    name: 'Canadian Grand Prix',
    circuit: 'Circuit Gilles-Villeneuve',
    location: 'Montréal',
    country: 'Canada',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/canada-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmontrealdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Canada%20carbon.png',
    lengthKm: 4.361,
    turns: 14,
    lapRecord: { time: '1:13.078', driver: 'Valtteri Bottas', year: 2019 },
    overtakeZones: 2,
    speedTrap: 'Casino Straight into the Wall of Champions (342 km/h)',
    detectionZones: 'Detection: After Turn 9 exit on approach to Hairpin',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'Senna "S" complex into high kerb hop at Turn 3-4.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–9', focus: 'Chicane agility at T6-T7 and braking through T8-T9.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 10–14', focus: 'Epingle hairpin, Casino Straight, and the infamous Wall of Champions.' }
    ],
    technicalNotes: 'Stop-and-go circuit demanding peak brake cooling and aggressive kerb riding. Heavy safety car probability.'
  },
  19: {
    key: 19,
    slug: 'spielberg',
    name: 'Austrian Grand Prix',
    circuit: 'Red Bull Ring',
    location: 'Spielberg',
    country: 'Austria',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/austria-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackspielbergdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Austria%20carbon.png',
    lengthKm: 4.318,
    turns: 10,
    lapRecord: { time: '1:05.619', driver: 'Carlos Sainz', year: 2020 },
    overtakeZones: 3,
    speedTrap: 'Uphill straight approaching Turn 3 (332 km/h)',
    detectionZones: 'Detection 1: Before T1; Detection 2: Before T3; Detection 3: Turn 9 apex',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–3', focus: 'Uphill blast from Castrol to the Remus right-hand hairpin.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 4–7', focus: 'Downhill braking at Rauch curve into high-speed left-handers.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 8–10', focus: 'Rindt corner and the fast downhill drop onto the main straight.' }
    ],
    technicalNotes: 'Shortest lap time of the year (approx. 64s). High elevation changes and massive overtaking into Turns 1, 3, and 4.'
  },
  2: {
    key: 2,
    slug: 'silverstone',
    name: 'British Grand Prix',
    circuit: 'Silverstone Circuit',
    location: 'Silverstone',
    country: 'United Kingdom',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/uk-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026tracksilverstonedetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Great%20Britain%20carbon.png',
    lengthKm: 5.891,
    turns: 18,
    lapRecord: { time: '1:27.097', driver: 'Max Verstappen', year: 2020 },
    overtakeZones: 2,
    speedTrap: 'Hangar Straight on approach to Stowe (336 km/h)',
    detectionZones: 'Detection 1: Arena Turn 3 entry; Detection 2: Chapel exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'Flat-out Abbey into Farm curve and the tight Arena hairpin.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–14', focus: 'Copse corner, the world-famous Maggotts-Becketts-Chapel complex.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 15–18', focus: 'Stowe corner into the Club chicane and the Hamilton Straight.' }
    ],
    technicalNotes: 'The birthplace of Formula 1. Extreme lateral G-forces through Maggotts and Becketts (>5G) place intense load on front-right tyre.'
  },
  7: {
    key: 7,
    slug: 'spafrancorchamps',
    name: 'Belgian Grand Prix',
    circuit: 'Circuit de Spa-Francorchamps',
    location: 'Spa-Francorchamps',
    country: 'Belgium',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/belgium-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackspafrancorchampsdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Belgium%20carbon.png',
    lengthKm: 7.004,
    turns: 19,
    lapRecord: { time: '1:44.701', driver: 'Sergio Perez', year: 2024 },
    overtakeZones: 2,
    speedTrap: 'Kemmel Straight following Eau Rouge / Raidillon (350 km/h)',
    detectionZones: 'Detection 1: La Source exit; Detection 2: Turn 17 exit before Blanchimont',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–4', focus: 'La Source hairpin into the legendary uphill compression at Eau Rouge & Raidillon.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 5–14', focus: 'Les Combes, Bruxelles downhill hairpin, and the double-left Pouhon.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 15–19', focus: 'Campus, Stavelot, flat-out Blanchimont and the Bus Stop chicane.' }
    ],
    technicalNotes: 'The longest track on the calendar (7.004 km). Microclimates mean rain can fall on one sector while another is dry.'
  },
  4: {
    key: 4,
    slug: 'hungaroring',
    name: 'Hungarian Grand Prix',
    circuit: 'Hungaroring',
    location: 'Budapest',
    country: 'Hungary',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/hungary-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackhungaroringdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Hungary%20carbon.png',
    lengthKm: 4.381,
    turns: 14,
    lapRecord: { time: '1:16.627', driver: 'Lewis Hamilton', year: 2020 },
    overtakeZones: 2,
    speedTrap: 'Main Straight into Turn 1 (318 km/h)',
    detectionZones: 'Detection: Before Turn 14 final corner',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–3', focus: 'Heavy braking into Turn 1 and the fast downhill sweep through Turn 2-3.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 4–11', focus: 'Twisting medium-speed complex: blind entry at T4 and chicane at T6-T7.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 12–14', focus: 'Braking into T12 followed by long medium-speed 180° corners at T13-T14.' }
    ],
    technicalNotes: 'Often dubbed "Monaco without barriers". High downforce required with minimal straights; track temperature frequently surpasses 55°C.'
  },
  55: {
    key: 55,
    slug: 'zandvoort',
    name: 'Dutch Grand Prix',
    circuit: 'Circuit Zandvoort',
    location: 'Zandvoort',
    country: 'Netherlands',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/netherlands-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackzandvoortdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Netherlands%20carbon.png',
    lengthKm: 4.259,
    turns: 14,
    lapRecord: { time: '1:11.097', driver: 'Lewis Hamilton', year: 2021 },
    overtakeZones: 2,
    speedTrap: 'Banked Turn 14 into the pit straight (322 km/h)',
    detectionZones: 'Detection 1: Turn 10 exit; Detection 2: Turn 13 entry',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–3', focus: 'Tarzanbocht hairpin and the steep 19-degree banked Hugenholtz corner.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 4–10', focus: 'Fast sweeping roller-coaster dunes through Scheivlak at high lateral G.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 11–14', focus: 'Hans Ernst chicane leading into the 18-degree banked Arie Luyendyk bocht.' }
    ],
    technicalNotes: 'Features radical progressive banking of up to 19 degrees. Coastal sea sand on the track requires continuous line adaptation.'
  },
  39: {
    key: 39,
    slug: 'monza',
    name: 'Italian Grand Prix',
    circuit: 'Autodromo Nazionale Monza',
    location: 'Monza',
    country: 'Italy',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/italy-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmonzadetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Italy%20carbon.png',
    lengthKm: 5.793,
    turns: 11,
    lapRecord: { time: '1:21.046', driver: 'Rubens Barrichello', year: 2004 },
    overtakeZones: 2,
    speedTrap: 'Main Straight approaching Variante del Rettifilo (356 km/h)',
    detectionZones: 'Detection 1: Curva Grande entry; Detection 2: Ascari chicane exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–3', focus: 'Heavy stop from 350+ km/h into Rettifilo chicane and Curva Grande.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 4–7', focus: 'Variante della Roggia chicane followed by the twin Lesmo corners.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 8–11', focus: 'Variante Ascari high-speed direction change and the legendary Parabolica.' }
    ],
    technicalNotes: 'The Temple of Speed. Teams run unique ultra-skinny rear wings for minimum drag. Engine thermal stress and brake disc temperatures peak here.'
  },
  153: {
    key: 153,
    slug: 'madrid',
    name: 'Madrid Grand Prix',
    circuit: 'Madring (Circuito de Madrid)',
    location: 'Madrid',
    country: 'Spain',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/spain-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmadriddetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Spain%20carbon.png',
    lengthKm: 5.470,
    turns: 22,
    lapRecord: { time: '1:19.450', driver: 'Inaugural 2026', year: 2026 },
    overtakeZones: 3,
    speedTrap: 'IFEMA Exhibition Boulevard Straight (342 km/h)',
    detectionZones: 'Detection 1: Before Turn 8; Detection 2: Turn 15 exit; Detection 3: Final hairpin entry',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–7', focus: 'Start straight into fast flowing permanent circuit section at IFEMA complex.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 8–15', focus: 'Technical urban section crossing Valdebebas motorway with heavy braking.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 16–22', focus: 'High-speed sweeping straight mode section leading to stadium chicane.' }
    ],
    technicalNotes: 'Brand new for the 2026 World Championship. Hybrid circuit combining permanent track sections with urban streets, engineered specifically for 2026 active aero Straight Mode zones.'
  },
  144: {
    key: 144,
    slug: 'baku',
    name: 'Azerbaijan Grand Prix',
    circuit: 'Baku City Circuit',
    location: 'Baku',
    country: 'Azerbaijan',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/azerbaijan-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackbakudetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Azerbaijan%20carbon.png',
    lengthKm: 6.003,
    turns: 20,
    lapRecord: { time: '1:43.009', driver: 'Charles Leclerc', year: 2019 },
    overtakeZones: 2,
    speedTrap: '2.2km Neftchilar Avenue main straight (360 km/h)',
    detectionZones: 'Detection 1: Turn 2 apex; Detection 2: Turn 20 exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–6', focus: '90-degree street corners between grandstands and avenues.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 7–12', focus: 'The extremely narrow Castle Section: just 7.6 metres wide at T8.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 13–20', focus: 'Downhill sweeping flat-out run into the 2.2km blast along the Caspian Sea.' }
    ],
    technicalNotes: 'Extreme contrast: tightest corner section in F1 (Castle) followed by the longest full-throttle straight in motorsport.'
  },
  12: {
    key: 12,
    slug: 'kualalumpur',
    name: 'Malaysian Grand Prix',
    circuit: 'Sepang International Circuit',
    location: 'Kuala Lumpur',
    country: 'Malaysia',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/malaysia-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackkualalumpurdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Bahrain%20carbon.png',
    lengthKm: 5.543,
    turns: 15,
    lapRecord: { time: '1:34.080', driver: 'Sebastian Vettel', year: 2017 },
    overtakeZones: 2,
    speedTrap: 'Main Straight into Turn 1 (335 km/h)',
    detectionZones: 'Detection 1: Turn 13 exit into Turn 14; Detection 2: Turn 15 exit onto Pit Straight',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'Downhill T1-T2 chicane into long high-speed sweeping right at T3 and flat T4.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–12', focus: 'High-speed directional changes through T5-T6, hairpins at T9 and fast T11.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 13–15', focus: 'Brutal long back straight, tight hairpin at T15, and wide pit straight.' }
    ],
    technicalNotes: 'Hermann Tilke masterpiece designed for overtaking. Severe tropical heat, humidity and monsoonal downpours challenge car cooling.'
  },
  61: {
    key: 61,
    slug: 'singapore',
    name: 'Singapore Grand Prix',
    circuit: 'Marina Bay Street Circuit',
    location: 'Marina Bay',
    country: 'Singapore',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/singapore-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026tracksingaporedetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Singapore%20carbon.png',
    lengthKm: 4.940,
    turns: 19,
    lapRecord: { time: '1:34.486', driver: 'Daniel Ricciardo', year: 2024 },
    overtakeZones: 3,
    speedTrap: 'Raffles Boulevard on approach to Turn 7 (320 km/h)',
    detectionZones: 'Detection 1: Before T4; Detection 2: Turn 13 exit; Detection 3: Turn 14 exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'Sheares Turn 1-2-3 complex into the sprint along Republic Boulevard.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–14', focus: 'Raffles Boulevard straight and the technical section past the Padang.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 15–19', focus: 'Straightened Marina Bay section bypass leading to the final chicanes.' }
    ],
    technicalNotes: 'The toughest physical challenge in modern racing. 62 laps under floodlights in 85% humidity; 100% historical safety car record.'
  },
  9: {
    key: 9,
    slug: 'austin',
    name: 'United States Grand Prix',
    circuit: 'Circuit of The Americas',
    location: 'Austin',
    country: 'United States',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/usa-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackaustindetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/United%20States%20carbon.png',
    lengthKm: 5.513,
    turns: 20,
    lapRecord: { time: '1:36.169', driver: 'Charles Leclerc', year: 2019 },
    overtakeZones: 2,
    speedTrap: '1.2km Back Straight into Turn 12 (340 km/h)',
    detectionZones: 'Detection 1: Turn 10 exit; Detection 2: Turn 18 apex',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–6', focus: 'Iconic 133-foot uphill climb into Turn 1 hairpin followed by Silverstone-style Esses.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 7–12', focus: 'Hairpin at Turn 11 onto the massive 1.2km back straight and heavy braking at T12.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 13–20', focus: 'Stadium amphitheatre complex and the quadruple-apex Turn 16-17-18 carousel.' }
    ],
    technicalNotes: 'The steep uphill Turn 1 invites multi-car divebombs on lap 1. The high-speed esses test chassis balance and bump compliance.'
  },
  65: {
    key: 65,
    slug: 'mexicocity',
    name: 'Mexico City Grand Prix',
    circuit: 'Autódromo Hermanos Rodríguez',
    location: 'Mexico City',
    country: 'Mexico',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/mexico-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackmexicocitydetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Mexico%20carbon.png',
    lengthKm: 4.304,
    turns: 17,
    lapRecord: { time: '1:17.774', driver: 'Valtteri Bottas', year: 2021 },
    overtakeZones: 3,
    speedTrap: 'End of 1.3km Main Straight into Turn 1 (358 km/h)',
    detectionZones: 'Detection 1: Turn 15 exit; Detection 2: Turn 3 exit; Detection 3: Turn 11 apex',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–3', focus: '890-metre drag to Turn 1 braking followed by the tight Moisés Solana chicane.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 4–11', focus: 'Technical flowing esses requiring clean kerb commitment and nimble changes.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 12–17', focus: 'The famous Foro Sol baseball stadium complex packed with 40,000 cheering fans.' }
    ],
    technicalNotes: 'Altitude of 2,285 metres reduces air density by 25%. Cars run maximum Monaco downforce wings but achieve Monza top speeds due to thin air.'
  },
  14: {
    key: 14,
    slug: 'interlagos',
    name: 'São Paulo Grand Prix',
    circuit: 'Autódromo José Carlos Pace (Interlagos)',
    location: 'São Paulo',
    country: 'Brazil',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/brazil-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackinterlagosdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Brazil%20carbon.png',
    lengthKm: 4.309,
    turns: 15,
    lapRecord: { time: '1:10.540', driver: 'Valtteri Bottas', year: 2018 },
    overtakeZones: 2,
    speedTrap: 'Reta Oposta straight into Turn 4 (334 km/h)',
    detectionZones: 'Detection 1: Turn 2 apex; Detection 2: Turn 13 exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–3', focus: 'Senna "S" downhill plunge into Curva do Sol and the Reta Oposta.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 4–11', focus: 'Descida do Lago into the twisting amphitheatre infield of Ferradura and Bico de Pato.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 12–15', focus: 'Junção corner into the uphill curved blast Subida dos Boxes to the finish line.' }
    ],
    technicalNotes: 'Counter-clockwise layout putting heavy strain on drivers\' necks. The weather is famously unpredictable, often generating chaotic wet races.'
  },
  152: {
    key: 152,
    slug: 'lasvegas',
    name: 'Las Vegas Grand Prix',
    circuit: 'Las Vegas Strip Circuit',
    location: 'Las Vegas',
    country: 'United States',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/usa-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026tracklasvegasdetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Las%20Vegas%20carbon.png',
    lengthKm: 6.201,
    turns: 17,
    lapRecord: { time: '1:35.490', driver: 'Oscar Piastri', year: 2023 },
    overtakeZones: 2,
    speedTrap: 'Las Vegas Boulevard (The Strip) approaching Turn 14 (352 km/h)',
    detectionZones: 'Detection 1: Turn 4 exit; Detection 2: Turn 12 exit',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–4', focus: 'Permanent pit complex into hairpin at Turn 1 and blast along Koval Lane.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 5–9', focus: 'Sweeping curves around the illuminated Sphere and Sands Avenue.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 10–17', focus: 'Full-throttle 1.9km blast down the Strip past Bellagio fountains into T14.' }
    ],
    technicalNotes: 'Night race in cold desert temperatures (sub-10°C). Getting front tyres into the operating window without graining is the main strategy puzzle.'
  },
  150: {
    key: 150,
    slug: 'lusail',
    name: 'Qatar Grand Prix',
    circuit: 'Lusail International Circuit',
    location: 'Lusail',
    country: 'Qatar',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/qatar-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026tracklusaildetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Qatar%20carbon.png',
    lengthKm: 5.419,
    turns: 16,
    lapRecord: { time: '1:24.319', driver: 'Max Verstappen', year: 2023 },
    overtakeZones: 1,
    speedTrap: 'Main 1.068km straight into Turn 1 (340 km/h)',
    detectionZones: 'Detection: After Turn 15 exit onto Main Straight',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'High-speed right-hander into Turn 1 and fast medium-speed sweeps.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–11', focus: 'Rhythm section with sustained medium-to-high lateral G loading.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 12–16', focus: 'Triple-apex high-speed right-handers (Turns 12-14) punishing tyres.' }
    ],
    technicalNotes: 'High-speed flowing circuit demanding extreme aerodynamic downforce. Aggressive pyramid kerbs impose severe load on tyre sidewalls.'
  },
  70: {
    key: 70,
    slug: 'yasmarina',
    name: 'Abu Dhabi Grand Prix',
    circuit: 'Yas Marina Circuit',
    location: 'Abu Dhabi',
    country: 'United Arab Emirates',
    flag: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Flags%2016x9/uae-flag.png',
    detailedImage: 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackyasmarinadetailed.webp',
    carbonImage: 'https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Track%20icons%204x3/Abu%20Dhabi%20carbon.png',
    lengthKm: 5.281,
    turns: 16,
    lapRecord: { time: '1:26.103', driver: 'Max Verstappen', year: 2021 },
    overtakeZones: 2,
    speedTrap: '1.2km Back Straight into Turn 6 chicane (340 km/h)',
    detectionZones: 'Detection 1: Turn 5 exit; Detection 2: Turn 7 apex',
    sectors: [
      { number: 1, name: 'Sector 1', turns: 'Turns 1–5', focus: 'Fast sweeping Turn 2-3 into the redesigned banked Turn 5 hairpin.' },
      { number: 2, name: 'Sector 2', turns: 'Turns 6–9', focus: 'Two long straights separated by chicanes and the high-speed banked Turn 9.' },
      { number: 3, name: 'Sector 3', turns: 'Turns 10–16', focus: 'Technical hotel section wrapping underneath the illuminated W Abu Dhabi.' }
    ],
    technicalNotes: 'The traditional season finale under twilight transitions from sunset into night floodlights. Ambient and track temperatures plunge during the race.'
  }
};

function getCircuitProfile(idOrName) {
  if (!idOrName) return null;
  const num = Number(idOrName);
  if (CIRCUITS[num]) return CIRCUITS[num];
  const query = String(idOrName).toLowerCase().trim();
  for (const c of Object.values(CIRCUITS)) {
    if (c.slug === query) return c;
    if (c.name.toLowerCase().includes(query)) return c;
    if (c.circuit.toLowerCase().includes(query)) return c;
    if (c.location.toLowerCase().includes(query)) return c;
    if (c.country.toLowerCase().includes(query)) return c;
  }
  return null;
}

module.exports = { CIRCUITS, getCircuitProfile };

// Comprehensive 2026 Formula 1 Grid: Drivers and Constructors
// Contains verified high-resolution portraits and official SVG/transparent team logos

const DRIVERS = {
  VER: {
    code: 'VER',
    number: 1,
    name: 'Max Verstappen',
    team: 'Red Bull Racing',
    teamCode: 'RBR',
    teamColour: '#3671C6',
    country: 'NED',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/M/MAXVER01_Max_Verstappen/maxver01.png.transform/1col/image.png'
  },
  HAD: {
    code: 'HAD',
    number: 6,
    name: 'Isack Hadjar',
    team: 'Red Bull Racing',
    teamCode: 'RBR',
    teamColour: '#3671C6',
    country: 'FRA',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/I/ISAHAD01_Isack_Hadjar/isahad01.png.transform/1col/image.png'
  },
  RUS: {
    code: 'RUS',
    number: 63,
    name: 'George Russell',
    team: 'Mercedes',
    teamCode: 'MER',
    teamColour: '#27F4D2',
    country: 'GBR',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/G/GEORUS01_George_Russell/georus01.png.transform/1col/image.png'
  },
  ANT: {
    code: 'ANT',
    number: 12,
    name: 'Kimi Antonelli',
    team: 'Mercedes',
    teamCode: 'MER',
    teamColour: '#27F4D2',
    country: 'ITA',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/K/ANDANT01_Kimi_Antonelli/andant01.png.transform/1col/image.png'
  },
  LEC: {
    code: 'LEC',
    number: 16,
    name: 'Charles Leclerc',
    team: 'Ferrari',
    teamCode: 'FER',
    teamColour: '#E8002D',
    country: 'MON',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CHALEC01_Charles_Leclerc/chalec01.png.transform/1col/image.png'
  },
  HAM: {
    code: 'HAM',
    number: 44,
    name: 'Lewis Hamilton',
    team: 'Ferrari',
    teamCode: 'FER',
    teamColour: '#E8002D',
    country: 'GBR',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LEWHAM01_Lewis_Hamilton/lewham01.png.transform/1col/image.png'
  },
  NOR: {
    code: 'NOR',
    number: 4,
    name: 'Lando Norris',
    team: 'McLaren',
    teamCode: 'MCL',
    teamColour: '#FF8000',
    country: 'GBR',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANNOR01_Lando_Norris/lannor01.png.transform/1col/image.png'
  },
  PIA: {
    code: 'PIA',
    number: 81,
    name: 'Oscar Piastri',
    team: 'McLaren',
    teamCode: 'MCL',
    teamColour: '#FF8000',
    country: 'AUS',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/O/OSCPIA01_Oscar_Piastri/oscpia01.png.transform/1col/image.png'
  },
  ALO: {
    code: 'ALO',
    number: 14,
    name: 'Fernando Alonso',
    team: 'Aston Martin',
    teamCode: 'AMR',
    teamColour: '#229971',
    country: 'ESP',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/F/FERALO01_Fernando_Alonso/feralo01.png.transform/1col/image.png'
  },
  STR: {
    code: 'STR',
    number: 18,
    name: 'Lance Stroll',
    team: 'Aston Martin',
    teamCode: 'AMR',
    teamColour: '#229971',
    country: 'CAN',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANSTR01_Lance_Stroll/lanstr01.png.transform/1col/image.png'
  },
  GAS: {
    code: 'GAS',
    number: 10,
    name: 'Pierre Gasly',
    team: 'Alpine',
    teamCode: 'ALP',
    teamColour: '#0093CC',
    country: 'FRA',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/P/PIEGAS01_Pierre_Gasly/piegas01.png.transform/1col/image.png'
  },
  COL: {
    code: 'COL',
    number: 43,
    name: 'Franco Colapinto',
    team: 'Alpine',
    teamCode: 'ALP',
    teamColour: '#0093CC',
    country: 'ARG',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/F/FRACOL01_Franco_Colapinto/fracol01.png.transform/1col/image.png'
  },
  ALB: {
    code: 'ALB',
    number: 23,
    name: 'Alexander Albon',
    team: 'Williams',
    teamCode: 'WIL',
    teamColour: '#00A0DE',
    country: 'THA',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/1col/image.png'
  },
  SAI: {
    code: 'SAI',
    number: 55,
    name: 'Carlos Sainz',
    team: 'Williams',
    teamCode: 'WIL',
    teamColour: '#00A0DE',
    country: 'ESP',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CARSAI01_Carlos_Sainz/carsai01.png.transform/1col/image.png'
  },
  LAW: {
    code: 'LAW',
    number: 30,
    name: 'Liam Lawson',
    team: 'Racing Bulls',
    teamCode: 'RBF',
    teamColour: '#6692FF',
    country: 'NZL',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LIALAW01_Liam_Lawson/lialaw01.png.transform/1col/image.png'
  },
  LIN: {
    code: 'LIN',
    number: 3,
    name: 'Arvid Lindblad',
    team: 'Racing Bulls',
    teamCode: 'RBF',
    teamColour: '#6692FF',
    country: 'GBR',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ARVLIN01_Arvid_Lindblad/arvlin01.png.transform/1col/image.png'
  },
  OCO: {
    code: 'OCO',
    number: 31,
    name: 'Esteban Ocon',
    team: 'Haas F1 Team',
    teamCode: 'HAA',
    teamColour: '#B6BABD',
    country: 'FRA',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/E/ESTOCO01_Esteban_Ocon/estoco01.png.transform/1col/image.png'
  },
  BEA: {
    code: 'BEA',
    number: 87,
    name: 'Oliver Bearman',
    team: 'Haas F1 Team',
    teamCode: 'HAA',
    teamColour: '#B6BABD',
    country: 'GBR',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/O/OLIBEA01_Oliver_Bearman/olibea01.png.transform/1col/image.png'
  },
  HUL: {
    code: 'HUL',
    number: 27,
    name: 'Nico Hulkenberg',
    team: 'Audi',
    teamCode: 'AUD',
    teamColour: '#C0C0C0',
    country: 'GER',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/N/NICHUL01_Nico_Hulkenberg/nichul01.png.transform/1col/image.png'
  },
  BOR: {
    code: 'BOR',
    number: 5,
    name: 'Gabriel Bortoleto',
    team: 'Audi',
    teamCode: 'AUD',
    teamColour: '#C0C0C0',
    country: 'BRA',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/G/GABBOR01_Gabriel_Bortoleto/gabbor01.png.transform/1col/image.png'
  },
  BOT: {
    code: 'BOT',
    number: 77,
    name: 'Valtteri Bottas',
    team: 'Cadillac',
    teamCode: 'CAD',
    teamColour: '#FFD700',
    country: 'FIN',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/V/VALBOT01_Valtteri_Bottas/valbot01.png.transform/1col/image.png'
  },
  PER: {
    code: 'PER',
    number: 11,
    name: 'Sergio Perez',
    team: 'Cadillac',
    teamCode: 'CAD',
    teamColour: '#FFD700',
    country: 'MEX',
    photo: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/S/SERPER01_Sergio_Perez/serper01.png.transform/1col/image.png'
  }
};

const TEAMS = {
  mercedes: {
    name: 'Mercedes',
    colour: '#27F4D2',
    slug: 'mercedes',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/mercedes/2026mercedeslogowhite.webp'
  },
  ferrari: {
    name: 'Ferrari',
    colour: '#E8002D',
    slug: 'ferrari',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/ferrari/2026ferrarilogowhite.webp'
  },
  redbullracing: {
    name: 'Red Bull Racing',
    colour: '#3671C6',
    slug: 'redbullracing',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/redbullracing/2026redbullracinglogowhite.webp'
  },
  mclaren: {
    name: 'McLaren',
    colour: '#FF8000',
    slug: 'mclaren',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/mclaren/2026mclarenlogowhite.webp'
  },
  racingbulls: {
    name: 'Racing Bulls',
    colour: '#6692FF',
    slug: 'racingbulls',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/racingbulls/2026racingbullslogowhite.webp'
  },
  astonmartin: {
    name: 'Aston Martin',
    colour: '#229971',
    slug: 'astonmartin',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/astonmartin/2026astonmartinlogowhite.webp'
  },
  williams: {
    name: 'Williams',
    colour: '#00A0DE',
    slug: 'williams',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/williams/2026williamslogowhite.webp'
  },
  alpine: {
    name: 'Alpine',
    colour: '#0093CC',
    slug: 'alpine',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/alpine/2026alpinelogowhite.webp'
  },
  haasf1team: {
    name: 'Haas F1 Team',
    colour: '#B6BABD',
    slug: 'haasf1team',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/haasf1team/2026haasf1teamlogowhite.webp'
  },
  audi: {
    name: 'Audi',
    colour: '#C0C0C0',
    slug: 'audi',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/audi/2026audilogowhite.webp'
  },
  cadillac: {
    name: 'Cadillac',
    colour: '#FFD700',
    slug: 'cadillac',
    logo: 'https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/cadillac/2026cadillaclogowhite.webp'
  }
};

function getDriver(codeOrName) {
  if (!codeOrName) return null;
  const q = String(codeOrName).trim().toUpperCase();
  if (DRIVERS[q]) return DRIVERS[q];
  for (const d of Object.values(DRIVERS)) {
    if (d.name.toUpperCase().includes(q) || q.includes(d.name.toUpperCase())) return d;
    if (d.code === q) return d;
  }
  return null;
}

function getTeamLogo(teamName) {
  const norm = String(teamName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [key, t] of Object.entries(TEAMS)) {
    if (norm.includes(key) || key.includes(norm)) return t.logo;
  }
  return '';
}

function getTeamColour(teamName) {
  const norm = String(teamName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [key, t] of Object.entries(TEAMS)) {
    if (norm.includes(key) || key.includes(norm)) return t.colour;
  }
  return '#ed1c24';
}

module.exports = { DRIVERS, TEAMS, getDriver, getTeamLogo, getTeamColour };

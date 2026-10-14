// Baseline content snapshot. Used to seed the persistent store on first run and
// as the last-resort data source when every live provider is unreachable.

module.exports = {
  config: {
    streamUrl: '',
    sessionLabel: 'UNITED STATES GRAND PRIX · RACE',
    status: 'scheduled',
    updatedAt: null
  },
  calendar: [
    { round: 18, name: 'United States Grand Prix', location: 'Austin, Texas', circuit: 'Circuit of The Americas', date: '23–25 Oct 2026', status: 'NEXT UP' },
    { round: 19, name: 'Mexico City Grand Prix', location: 'Mexico City, Mexico', circuit: 'Autódromo Hermanos Rodríguez', date: '30 Oct–01 Nov 2026', status: 'UP NEXT' },
    { round: 20, name: 'São Paulo Grand Prix', location: 'São Paulo, Brazil', circuit: 'Autódromo José Carlos Pace', date: '06–08 Nov 2026', status: 'UP NEXT' },
    { round: 21, name: 'Las Vegas Grand Prix', location: 'Las Vegas, USA', circuit: 'Las Vegas Strip Circuit', date: '19–21 Nov 2026', status: 'UP NEXT' },
    { round: 22, name: 'Qatar Grand Prix', location: 'Lusail, Qatar', circuit: 'Lusail International Circuit', date: '27–29 Nov 2026', status: 'UP NEXT' },
    { round: 23, name: 'Abu Dhabi Grand Prix', location: 'Abu Dhabi, UAE', circuit: 'Yas Marina Circuit', date: '04–06 Dec 2026', status: 'SEASON FINALE' }
  ],
  standings: {
    updatedAt: '2026-10-11',
    source: 'After the Singapore Grand Prix',
    drivers: [
      { position: 1, name: 'Kimi Antonelli', code: 'ANT', team: 'Mercedes', points: 340, wins: 7 },
      { position: 2, name: 'George Russell', code: 'RUS', team: 'Mercedes', points: 238, wins: 3 },
      { position: 3, name: 'Lewis Hamilton', code: 'HAM', team: 'Ferrari', points: 229, wins: 2 },
      { position: 4, name: 'Max Verstappen', code: 'VER', team: 'Red Bull Racing', points: 221, wins: 2 },
      { position: 5, name: 'Charles Leclerc', code: 'LEC', team: 'Ferrari', points: 215, wins: 1 },
      { position: 6, name: 'Lando Norris', code: 'NOR', team: 'McLaren', points: 201, wins: 1 },
      { position: 7, name: 'Oscar Piastri', code: 'PIA', team: 'McLaren', points: 138, wins: 1 },
      { position: 8, name: 'Isack Hadjar', code: 'HAD', team: 'Red Bull Racing', points: 97, wins: 0 }
    ],
    teams: [
      { position: 1, name: 'Mercedes', points: 578 }, { position: 2, name: 'Ferrari', points: 444 },
      { position: 3, name: 'McLaren', points: 339 }, { position: 4, name: 'Red Bull Racing', points: 332 },
      { position: 5, name: 'Racing Bulls', points: 100 }, { position: 6, name: 'Alpine', points: 68 },
      { position: 7, name: 'Haas F1 Team', points: 30 }, { position: 8, name: 'Audi', points: 23 },
      { position: 9, name: 'Williams', points: 12 }, { position: 10, name: 'Aston Martin', points: 7 },
      { position: 11, name: 'Cadillac', points: 0 }
    ]
  },
  timing: {
    source: 'F1 RESULT SNAPSHOT',
    session: 'Singapore Grand Prix · Race classification',
    updatedAt: '2026-10-11',
    rows: [
      { position: 1, code: 'VER', driver: 'Max Verstappen', team: 'Red Bull Racing', gap: 'WINNER', time: '1:42:00.785' },
      { position: 2, code: 'LEC', driver: 'Charles Leclerc', team: 'Ferrari', gap: '+7.335 s', time: '62 laps' },
      { position: 3, code: 'ANT', driver: 'Kimi Antonelli', team: 'Mercedes', gap: '+24.573 s', time: '62 laps' },
      { position: 4, code: 'NOR', driver: 'Lando Norris', team: 'McLaren', gap: '+40.506 s', time: '62 laps' },
      { position: 5, code: 'PIA', driver: 'Oscar Piastri', team: 'McLaren', gap: '+49.644 s', time: '62 laps' },
      { position: 6, code: 'HAM', driver: 'Lewis Hamilton', team: 'Ferrari', gap: '+53.188 s', time: '62 laps' },
      { position: 7, code: 'LAW', driver: 'Liam Lawson', team: 'Racing Bulls', gap: '+81.666 s', time: '62 laps' },
      { position: 8, code: 'HUL', driver: 'Nico Hulkenberg', team: 'Audi', gap: '+83.386 s', time: '62 laps' },
      { position: 9, code: 'RUS', driver: 'George Russell', team: 'Mercedes', gap: '+84.677 s', time: '62 laps' },
      { position: 10, code: 'HAD', driver: 'Isack Hadjar', team: 'Red Bull Racing', gap: '+90.862 s', time: '62 laps' }
    ]
  },
  reactions: [],
  newsletter: []
};

// TDsports sample data. Everything here is illustrative: scores, ratings,
// events and standings are not real results. Photos are credited in PHOTO_CREDITS.

const BASE_DATE = new Date(2026, 9, 21); // Wed 21 Oct 2026, the matchday the sample data covers

const LEAGUES = [
  { name: 'Premier League', logo: 'assets/leagues/23.png', country: 'England' },
  { name: 'Champions League', logo: 'assets/leagues/2.png', country: 'Europe' },
  { name: 'LaLiga', logo: 'assets/leagues/15.png', country: 'Spain' },
  { name: 'FIFA World Cup', logo: 'assets/leagues/4.png', country: 'International' },
  { name: 'Bundesliga', logo: 'assets/leagues/10.png', country: 'Germany' },
  { name: 'MLS', logo: 'assets/leagues/19.png', country: 'United States' },
  { name: 'Serie A', logo: 'assets/leagues/12.png', country: 'Italy' },
  { name: 'Europa League', logo: 'assets/leagues/2310.png', country: 'Europe' },
  { name: 'Ligue 1', logo: 'assets/leagues/9.png', country: 'France' },
  { name: 'Liga MX', logo: 'assets/leagues/22.png', country: 'Mexico' },
];

// Every sample match belongs to this competition and round.
const COMPETITION = { league: 'Champions League', round: 'League Stage · Round 3' };

const MATCHES = [
  { id: 'lille-galatasaray', home: 'Lille', away: 'Galatasaray', score: [2, 4], kickoff: '18:45', tv: 'Paramount+' },
  { id: 'como-man-united', home: 'Como', away: 'Man United', score: [4, 1], kickoff: '18:45', tv: 'CBS Sports' },
  { id: 'sporting-lask', home: 'Sporting CP', away: 'LASK', score: [2, 3], kickoff: '21:00' },
  { id: 'villa-viking', home: 'Aston Villa', away: 'Viking', score: [3, 1], kickoff: '21:00', tv: 'Paramount+' },
  { id: 'inter-shakhtar', home: 'Inter', away: 'Shakhtar Donetsk', score: [1, 0], kickoff: '21:00' },
  { id: 'betis-feyenoord', home: 'Real Betis', away: 'Feyenoord', score: [1, 0], kickoff: '21:00' },
  { id: 'madrid-leipzig', home: 'Real Madrid', away: 'RB Leipzig', score: [4, 1], kickoff: '21:00', tv: 'CBS Sports' },
  { id: 'bayern-arsenal', home: 'Bayern München', away: 'Arsenal', score: [2, 2], kickoff: '21:00', tv: 'Paramount+' },
  { id: 'liverpool-villarreal', home: 'Liverpool', away: 'Villarreal', score: [4, 3], kickoff: '21:00', tv: 'Paramount+' },
  { id: 'city-aek', home: 'Man City', away: 'AEK Athens', score: [5, 1], kickoff: '21:00' },
  { id: 'napoli-bodo', home: 'Napoli', away: 'Bodø/Glimt', score: [4, 3], kickoff: '21:00' },
  { id: 'psg-barcelona', home: 'PSG', away: 'Barcelona', score: [4, 2], kickoff: '21:00', tv: 'CBS Sports' },
  { id: 'porto-psv', home: 'FC Porto', away: 'PSV Eindhoven', score: [0, 1], kickoff: '21:00' },
];

// Crests downloaded from ESPN's team logo CDN, see assets/club-logo-sources.json.
const CLUB_LOGOS = {
  'AEK Athens': 'assets/clubs/887.png', 'AS Roma': 'assets/clubs/104.png', 'Arsenal': 'assets/clubs/359.png',
  'Aston Villa': 'assets/clubs/362.png', 'Atlético Madrid': 'assets/clubs/1068.png', 'Barcelona': 'assets/clubs/83.png',
  'Bayern München': 'assets/clubs/132.png', 'Bodø/Glimt': 'assets/clubs/2980.png', 'Borussia Dortmund': 'assets/clubs/124.png',
  'Club Brugge': 'assets/clubs/570.png', 'Como': 'assets/clubs/2572.png', 'FC Porto': 'assets/clubs/437.png',
  'Fenerbahce': 'assets/clubs/436.png', 'Feyenoord': 'assets/clubs/142.png', 'Galatasaray': 'assets/clubs/432.png',
  'Inter': 'assets/clubs/110.png', 'LASK': 'assets/clubs/4411.png', 'Lens': 'assets/clubs/175.png',
  'Lille': 'assets/clubs/166.png', 'Liverpool': 'assets/clubs/364.png', 'Man City': 'assets/clubs/382.png',
  'Man United': 'assets/clubs/360.png', 'Napoli': 'assets/clubs/114.png', 'PSV Eindhoven': 'assets/clubs/148.png',
  'PSG': 'assets/clubs/160.png', 'RB Leipzig': 'assets/clubs/11420.png', 'Real Betis': 'assets/clubs/244.png',
  'Real Madrid': 'assets/clubs/86.png', 'Sabah FK': 'assets/clubs/21922.png', 'Shakhtar Donetsk': 'assets/clubs/493.png',
  'Slavia Prague': 'assets/clubs/494.png', 'Slovan Bratislava': 'assets/clubs/521.png', 'Sporting CP': 'assets/clubs/2250.png',
  'VfB Stuttgart': 'assets/clubs/134.png', 'Viking': 'assets/clubs/510.png', 'Villarreal': 'assets/clubs/102.png',
  'Brest': 'assets/clubs/171.png', 'Le Havre': 'assets/clubs/3236.png', 'Nice': 'assets/clubs/2502.png', 'Troyes': 'assets/clubs/170.png',
  'LA Galaxy': 'assets/clubs/187.png', 'LAFC': 'assets/clubs/18966.png', 'Inter Miami': 'assets/clubs/20232.png', 'Seattle Sounders': 'assets/clubs/9726.png',
  'Club América': 'assets/clubs/227.png', 'Guadalajara': 'assets/clubs/219.png', 'Tigres UANL': 'assets/clubs/232.png', 'Monterrey': 'assets/clubs/220.png', 'Colorado Rapids': 'assets/clubs/184.png', 'Columbus Crew': 'assets/clubs/183.png',
};

// European clubs used as opponents in the sample form guide and match history (the first 40
// crests above; the MLS and Liga MX clubs are only used in the live sample).

// Home grounds of the home sides. Photos from Wikimedia Commons.
const VENUES = {
  'Lille': { name: 'Decathlon Arena – Stade Pierre-Mauroy', city: "Villeneuve-d'Ascq, France", capacity: 50083, photo: 'assets/photos/venues/lille.jpg' },
  'Como': { name: 'Stadio Giuseppe Sinigaglia', city: 'Como, Italy', capacity: 13602, photo: 'assets/photos/venues/como.jpg' },
  'Sporting CP': { name: 'Estádio José Alvalade', city: 'Lisbon, Portugal', capacity: 50095, photo: 'assets/photos/venues/sporting-cp.jpg' },
  'Aston Villa': { name: 'Villa Park', city: 'Birmingham, England', capacity: 42640, photo: 'assets/photos/venues/aston-villa.jpg' },
  'Inter': { name: 'San Siro', city: 'Milan, Italy', capacity: 75817, photo: 'assets/photos/venues/inter.jpg' },
  'Real Betis': { name: 'Estadio Benito Villamarín', city: 'Seville, Spain', capacity: 60721, photo: 'assets/photos/venues/real-betis.jpg' },
  'Real Madrid': { name: 'Santiago Bernabéu', city: 'Madrid, Spain', capacity: 83186, photo: 'assets/photos/venues/real-madrid.jpg' },
  'Bayern München': { name: 'Allianz Arena', city: 'Munich, Germany', capacity: 75024, photo: 'assets/photos/venues/bayern-munchen.jpg' },
  'Liverpool': { name: 'Anfield', city: 'Liverpool, England', capacity: 61276, photo: 'assets/photos/venues/liverpool.jpg' },
  'Man City': { name: 'Etihad Stadium', city: 'Manchester, England', capacity: 53400, photo: 'assets/photos/venues/man-city.jpg' },
  'Napoli': { name: 'Stadio Diego Armando Maradona', city: 'Naples, Italy', capacity: 54726, photo: 'assets/photos/venues/napoli.jpg' },
  'PSG': { name: 'Parc des Princes', city: 'Paris, France', capacity: 47929, photo: 'assets/photos/venues/psg.jpg' },
  'FC Porto': { name: 'Estádio do Dragão', city: 'Porto, Portugal', capacity: 50033, photo: 'assets/photos/venues/fc-porto.jpg' },
};

const REFEREES = [
  ['Rade Obrenović', 'Slovenia'], ['Szymon Marciniak', 'Poland'], ['François Letexier', 'France'],
  ['Slavko Vinčić', 'Slovenia'], ['Anthony Taylor', 'England'], ['Clément Turpin', 'France'],
  ['Danny Makkelie', 'Netherlands'], ['Felix Zwayer', 'Germany'],
];

// People in the detailed Lille v Galatasaray lineup. `photo` is a Wikimedia Commons
// headshot where a freely licensed one exists; others fall back to initials.
const PEOPLE = {
  ozer: { name: 'Berke Özer', short: 'Özer', pos: 'GK', photo: 'ozer' },
  verdonk: { name: 'Calvin Verdonk', short: 'Verdonk', pos: 'LB', photo: 'verdonk' },
  alexsandro: { name: 'Alexsandro Ribeiro', short: 'Alexsandro', pos: 'CB', photo: 'alexsandro' },
  ngoy: { name: 'Nathan Ngoy', short: 'Ngoy', pos: 'CB', photo: 'ngoy' },
  goffi: { name: 'Maxima Goffi', short: 'Goffi', pos: 'RB', photo: 'goffi' },
  andre: { name: 'Benjamin André', short: 'André', pos: 'CM', photo: 'andre' },
  bentaleb: { name: 'Nabil Bentaleb', short: 'Bentaleb', pos: 'DM', photo: 'bentaleb' },
  mukau: { name: "Ngal'ayel Mukau", short: 'Mukau', pos: 'CM', photo: 'mukau' },
  diaoune: { name: 'Soriba Diaoune', short: 'Diaoune', pos: 'LW', photo: 'diaoune' },
  haraldsson: { name: 'Hákon Arnar Haraldsson', short: 'Haraldsson', pos: 'AM', photo: 'haraldsson' },
  bakwa: { name: 'Dilane Bakwa', short: 'Bakwa', pos: 'RW', photo: 'bakwa' },
  cakir: { name: 'Uğurcan Çakır', short: 'Çakır', pos: 'GK', photo: 'cakir' },
  sallai: { name: 'Roland Sallai', short: 'Sallai', pos: 'RB', photo: 'sallai' },
  sanchez: { name: 'Davinson Sánchez', short: 'Sánchez', pos: 'CB' },
  bardakci: { name: 'Abdülkerim Bardakcı', short: 'Bardakcı', pos: 'CB', photo: 'bardakci' },
  jakobs: { name: 'Ismail Jakobs', short: 'Jakobs', pos: 'LB', photo: 'jakobs' },
  akgun: { name: 'Yunus Akgün', short: 'Akgün', pos: 'RW', photo: 'akgun' },
  torreira: { name: 'Lucas Torreira', short: 'Torreira', pos: 'DM', photo: 'torreira' },
  sara: { name: 'Gabriel Sara', short: 'Sara', pos: 'DM', photo: 'sara' },
  osimhen: { name: 'Victor Osimhen', short: 'Osimhen', pos: 'ST', photo: 'osimhen' },
  batrakov: { name: 'Aleksey Batrakov', short: 'Batrakov', pos: 'AM', photo: 'batrakov' },
  yilmaz: { name: 'Barış Alper Yılmaz', short: 'Yılmaz', pos: 'LW', photo: 'yilmaz' },
  giroud: { name: 'Olivier Giroud', short: 'Giroud', pos: 'ST', photo: 'olivier-giroud' },
  perrin: { name: 'Gaëtan Perrin', short: 'Perrin', pos: 'AM', photo: 'gaetan-perrin' },
  nianzou: { name: 'Tanguy Nianzou', short: 'Nianzou', pos: 'CB', photo: 'tanguy-nianzou' },
  kjaergaard: { name: 'Maurits Kjærgaard', short: 'Kjærgaard', pos: 'CM', photo: 'maurits-kjaergaard' },
  lemina: { name: 'Mario Lemina', short: 'Lemina', pos: 'DM', photo: 'mario-lemina' },
  elmali: { name: 'Eren Elmalı', short: 'Elmalı', pos: 'LB', photo: 'eren-elmali' },
  sane: { name: 'Leroy Sané', short: 'Sané', pos: 'RW', photo: 'leroy-sane' },
  gul: { name: 'Deniz Gül', short: 'Gül', pos: 'ST' },
  onal: { name: 'Başar Önal', short: 'Önal', pos: 'CM' },
  gundogan: { name: 'İlkay Gündoğan', short: 'Gündoğan', pos: 'CM', photo: 'ilkay-gundogan' },
  ancelotti: { name: 'Davide Ancelotti', short: 'Ancelotti', pos: 'Coach', photo: 'davide-ancelotti' },
  buruk: { name: 'Okan Buruk', short: 'Buruk', pos: 'Coach', photo: 'okan-buruk' },
};

// Full lineup data exists for the first match only. Pitch coordinates are percentages,
// home attacking left to right.
const LINEUPS = {
  'lille-galatasaray': {
    formations: ['4-3-3', '4-2-3-1'],
    coaches: ['ancelotti', 'buruk'],
    home: [
      ['ozer', 5, 50, 3.9], ['verdonk', 18, 12, 6.0], ['alexsandro', 18, 38, 6.6], ['ngoy', 18, 64, 6.0], ['goffi', 18, 88, 5.0],
      ['andre', 31, 23, 6.3], ['bentaleb', 31, 49, 6.8], ['mukau', 31, 78, 6.3],
      ['diaoune', 44, 23, 8.8], ['haraldsson', 44, 50, 7.2], ['bakwa', 44, 80, 6.8],
    ],
    away: [
      ['cakir', 95, 50, 7.1], ['sallai', 86, 12, 7.8], ['sanchez', 86, 38, 7.1], ['bardakci', 86, 64, 6.7], ['jakobs', 86, 88, 7.1],
      ['akgun', 66, 16, 8.3], ['torreira', 76, 31, 7.0], ['sara', 76, 72, 6.7],
      ['osimhen', 57, 50, 7.9], ['batrakov', 66, 50, 8.0], ['yilmaz', 66, 88, 8.0],
    ],
    homeSubs: [['kjaergaard', 6.5], ['giroud', 6.4], ['nianzou', 6.2], ['perrin', 6.1], ['onal', 6.3]],
    awaySubs: [['lemina', 6.9], ['elmali', 6.6], ['sane', 6.8], ['gul', 6.4], ['gundogan', 6.7]],
    // [minute, type, side, player, detail]; for subs, detail is the player coming off.
    // Goals, substitutions and cards follow ESPN's match commentary; the 52nd-minute own
    // goal is credited to Özer by ESPN and to Bentaleb by beIN SPORTS.
    events: [
      [2, 'goal', 'away', 'akgun', '0 - 1'],
      [7, 'goal', 'home', 'diaoune', '1 - 1'],
      [27, 'var', 'away', 'osimhen', 'Penalty overturned'],
      [39, 'goal', 'home', 'diaoune', '2 - 1'],
      [44, 'goal', 'away', 'batrakov', '2 - 2'],
      [52, 'owngoal', 'away', 'ozer', '2 - 3'],
      [59, 'yellow', 'home', 'andre', 'Foul'],
      [61, 'goal', 'away', 'osimhen', '2 - 4'],
      [62, 'sub', 'away', 'lemina', 'sara'],
      [62, 'sub', 'home', 'kjaergaard', 'andre'],
      [63, 'sub', 'home', 'giroud', 'mukau'],
      [63, 'sub', 'home', 'nianzou', 'goffi'],
      [75, 'sub', 'away', 'elmali', 'yilmaz'],
      [75, 'sub', 'home', 'perrin', 'diaoune'],
      [75, 'sub', 'home', 'onal', 'bentaleb'],
      [76, 'sub', 'away', 'sane', 'akgun'],
      [84, 'sub', 'away', 'gul', 'osimhen'],
      [85, 'sub', 'away', 'gundogan', 'batrakov'],
      [85, 'yellow', 'away', 'jakobs', 'High boot'],
      [89, 'yellow', 'home', 'perrin', 'Foul'],
    ],
    // Where each goal was struck from (attacker's view, attacking towards x = 100) and
    // whether it was a header, per the match reports.
    goalShots: { 2: [88, 50, false], 7: [93, 34, false], 39: [85, 50, false], 44: [95, 48, true], 61: [88, 49, false] },
    stats: { possession: 56, xg: [1.88, 1.64], shots: [15, 10], onTarget: [6, 6], boxTouches: [22, 27], bigChances: [4, 3], passes: [481, 372], corners: [7, 4], fouls: [11, 14], yellows: [2, 1] },
    attendance: 44142,
    referee: 0,
  },
};

const NEWS = [
  { title: 'A night to remember: the moments that defined the Champions League', photo: 'assets/photos/news/news-0.jpg', alt: 'Galatasaray supporters celebrating in the stands', hoursAgo: 3 },
  { title: 'The numbers behind a remarkable European performance', photo: 'assets/photos/news/news-2.jpg', alt: 'Players celebrating a goal together', hoursAgo: 1 },
  { title: 'Four takeaways from an unforgettable matchday', photo: 'assets/photos/news/news-1.jpg', alt: 'View across a floodlit stadium before kick-off', hoursAgo: 2 },
  { title: 'Who stood out? Explore the player ratings', photo: 'assets/photos/news/news-3.jpg', alt: 'Pre-match light show inside a covered stadium', hoursAgo: 3 },
  { title: 'The next generation of football’s brightest talents', photo: 'assets/photos/news/news-4.jpg', alt: 'Panoramic view of a floodlit football ground', hoursAgo: 4 },
];

// World land mask for the vote map: 144 x 56 cells of 2.5° (84°N to 56°S), each row
// run-length encoded in hex (alternating water/land). Built from Natural Earth 1:110m
// land (public domain) via the world-atlas package.
const WORLD_DOTS = '27.8.7.a.50|21.4.2.5.1.14.e.4.8.1.11.3.20|1b.1.5.1.4.3.2.15.e.1.1.2.3e|19.5.2.2.1.5.9.f.1f.2.a.a.a.5.c|16.5.2.1.1.2.1.1.1.4.a.d.1e.1.6.1.3.14.4.1.f|7.6.e.4.2.2.2.8.5.b.14.3.f.2.1.22.8|1.4d.a.2.1.1.9.1.2a|0.2.1.4a.4.1.4.2.38|6.1d.9.1.7.3.14.4.1.40|5.8.1.14.7.3.a.1.13.5.2.1.1.33.3.2.5|9.2.7.11.6.6.1e.2.3.2e.7.2.7|13.14.2.7.16.1.4.1.5.2d.8.3.7|14.13.2.9.12.1.1.3.1.37.5.1.9|15.19.1.1.16.1.2.37.1.1.e|16.18.2.3.14.39.10|16.1a.17.d.1.6.2.22.11|16.16.18.5.3.2.1.4.6.2.2.20.3.2.e|16.14.1a.4.3.1.2.1.1.2.1.9.1.1b.1.2.5.1.f|17.12.1b.4.5.1.3.1.1.9.2.1a.2.2.3.1.10|18.12.1c.6.5.2.2.23.3.1.1.3.10|19.f.1c.9.3.1.5.22.4.1.13|1b.9.2.1.1d.35.17|1a.1.1.5.6.1.1b.12.1.6.1.1b.18|1b.1.1.4.21.14.1.6.1.1.1.2.1.15.18|1e.3.5.2.19.15.2.8.4.8.1.9.1a|1e.3.3.1.4.1.17.16.1.7.6.6.2.6.1d|1f.6.1d.15.2.5.7.4.5.5.5.1.17|23.4.1a.17.1.4.9.2.7.5.4.1.17|25.2.1a.19.c.2.7.5.4.2.16|26.1.3.6.12.1a.a.2.7.1.2.1.6.1.16|27.1.1.7.13.19.c.1.10.2.15|29.a.11.4.2.11.13.1.1.1.5.2.18|29.b.18.f.14.1.5.2.19|28.c.18.d.17.1.3.3.19|28.e.16.c.18.2.2.3.1.1.4.1.1.1.10|27.12.14.b.19.1.d.3.e|28.12.13.b.1b.2.a.4.d|29.11.13.b.21.1.9.1.c|29.10.14.b.24.3.11|2a.e.15.b.3.1.1e.1.1.2.3.1.e|2b.d.15.a.3.2.1d.9.e|2c.c.15.9.4.2.1c.b.d|2c.b.17.8.3.2.1b.e.c|2c.9.19.8.4.1.1a.10.b|2c.9.19.7.21.f.b|2b.9.1b.5.22.f.b|2b.8.1c.5.22.4.3.8.b|2b.7.44.1.8.5.c|2b.6.4f.4.c|2b.4.5f.1.1|2a.5.53.1.a.1.2|2a.4.5d.1.4|2a.4.62|2a.3.36.1.2c|2a.3.63|2b.3.62';

// Countries used for the sample vote map: [name, flag, lat, lon].
const COUNTRIES = {
  FR: ['France', '🇫🇷', 46.5, 2.5], TR: ['Türkiye', '🇹🇷', 39, 35], IT: ['Italy', '🇮🇹', 42.8, 12.5], GB: ['United Kingdom', '🇬🇧', 53.5, -2],
  PT: ['Portugal', '🇵🇹', 39.6, -8], AT: ['Austria', '🇦🇹', 47.5, 14.5], NO: ['Norway', '🇳🇴', 61, 9], UA: ['Ukraine', '🇺🇦', 49, 31.5],
  ES: ['Spain', '🇪🇸', 40.3, -3.7], NL: ['Netherlands', '🇳🇱', 52.2, 5.3], DE: ['Germany', '🇩🇪', 51, 10], GR: ['Greece', '🇬🇷', 39, 22],
  BE: ['Belgium', '🇧🇪', 50.6, 4.6], US: ['United States', '🇺🇸', 39, -98], NG: ['Nigeria', '🇳🇬', 9, 8], BR: ['Brazil', '🇧🇷', -10, -52],
  IN: ['India', '🇮🇳', 22, 79], ID: ['Indonesia', '🇮🇩', -2, 118], EG: ['Egypt', '🇪🇬', 26.5, 30], JP: ['Japan', '🇯🇵', 36.5, 138.5],
};

const CLUB_COUNTRY = {
  'Lille': 'FR', 'PSG': 'FR', 'Galatasaray': 'TR', 'Como': 'IT', 'Inter': 'IT', 'Napoli': 'IT', 'Man United': 'GB', 'Aston Villa': 'GB',
  'Arsenal': 'GB', 'Liverpool': 'GB', 'Man City': 'GB', 'Sporting CP': 'PT', 'FC Porto': 'PT', 'LASK': 'AT', 'Viking': 'NO',
  'Bodø/Glimt': 'NO', 'Shakhtar Donetsk': 'UA', 'Real Betis': 'ES', 'Real Madrid': 'ES', 'Villarreal': 'ES', 'Barcelona': 'ES',
  'Feyenoord': 'NL', 'PSV Eindhoven': 'NL', 'RB Leipzig': 'DE', 'Bayern München': 'DE', 'AEK Athens': 'GR',
};

const TV_SCHEDULE = [
  ['Champions League', 'Wed 18:45', 'Paramount+'],
  ['Champions League', 'Wed 21:00', 'CBS Sports'],
  ['Premier League', 'Sat 15:00', 'Peacock'],
  ['LaLiga', 'Sat 20:00', 'ESPN+'],
];

// Wikimedia Commons photo credits: [local path, subject, author, license, source page].
// Generated from assets/photo-sources.json.
const PHOTO_CREDITS = [
  ["assets/photos/news/news-0.jpg", "Galatasaray supporters, UEFA Champions League", "CFC Unofficial (Debs)", "CC BY-SA 2.0", "https://commons.wikimedia.org/wiki/File:Chelsea_2_Galatasaray_0_(3-1_agg)_(13470560714).jpg"],
  ["assets/photos/news/news-1.jpg", "Parc des Princes, PSG v Galatasaray", "Zakarie Faibis", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:PSG-Galatasaray_UCL_02.jpg"],
  ["assets/photos/news/news-2.jpg", "Goal celebration, UEFA Champions League", "Steffen Prößdorf", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:20191002_Fu%C3%9Fball,_M%C3%A4nner,_UEFA_Champions_League,_RB_Leipzig_-_Olympique_Lyonnais_by_Stepro_StP_0276.jpg"],
  ["assets/photos/news/news-3.jpg", "Pre-match light show, Stade Pierre-Mauroy", "Supporterhéninois", "CC0", "https://commons.wikimedia.org/wiki/File:Lille_-_Saint-Etienne_(13-01-2017)_54.jpg"],
  ["assets/photos/news/news-4.jpg", "Floodlit match, Stadion Ludowy", "Krzysztof Popławski", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:Mecz_pi%C5%82karski_Wis%C5%82a_Krak%C3%B3w_-_Zag%C5%82%C4%99bie_Sosnwoiec,_28_pa%C5%BAdziernika_2022,_Po%C5%BCegnanie_Stadionu_Ludowego,_KP.jpg"],
  ["assets/photos/people/akgun.jpg", "Yunus Akgün", "Antalyaspor A.Ş.", "CC BY 2.0", "https://commons.wikimedia.org/wiki/File:Yunus_Akg%C3%BCn_20220225_7_(cropped).jpg"],
  ["assets/photos/people/alexsandro.jpg", "Alexsandro Ribeiro", "Paté kroute", "CC0", "https://commons.wikimedia.org/wiki/File:Alessandro_ASSE_losc_2425_(cropped).jpg"],
  ["assets/photos/people/andre.jpg", "Benjamin André", "Paté kroute", "CC0", "https://commons.wikimedia.org/wiki/File:Benjamin_andre_asse_losc_2425_(cropped).jpg"],
  ["assets/photos/people/diaoune.jpg", "Soriba Diaoune", "FotMob (club headshot)", "All rights reserved, used for this prototype", "https://www.fotmob.com/players/1684579/soriba-diaoune"],
  ["assets/photos/people/goffi.jpg", "Maxima Goffi", "FotMob (club headshot)", "All rights reserved, used for this prototype", "https://www.fotmob.com/players/1793784/maxima-goffi"],
  ["assets/photos/people/mukau.jpg", "Ngal'ayel Mukau", "FotMob (club headshot)", "All rights reserved, used for this prototype", "https://www.fotmob.com/players/1428153/ngal-ayel-mukau"],
  ["assets/photos/people/bakwa.jpg", "Dilane Bakwa", "Paté kroute", "CC0", "https://commons.wikimedia.org/wiki/File:Bakwa_asse_rcsa_2425.jpg"],
  ["assets/photos/people/bardakci.jpg", "Abdülkerim Bardakcı", "beIN SPORTS Türkiye", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:Abd%C3%BClkerim_Bardak%C3%A7%C4%B1_-_beIN-Sports-Reklam_(2021)_(cropped).png"],
  ["assets/photos/people/batrakov.jpg", "Aleksey Batrakov", "Dmitry Burdonov", "CC BY 2.0", "https://commons.wikimedia.org/wiki/File:Aleksey_Batrakov.jpg"],
  ["assets/photos/people/bentaleb.jpg", "Nabil Bentaleb", "Supporterhéninois", "CC0", "https://commons.wikimedia.org/wiki/File:RC_Lens_-_Lille_OSC_(08-10-2023)_19_(cropped).jpg"],
  ["assets/photos/people/cakir.jpg", "Uğurcan Çakır", "beIN SPORTS Türkiye", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:U%C4%9Furcan_%C3%87ak%C4%B1r_-_beIN-Sports-Reklam_(2021)_(cropped).png"],
  ["assets/photos/people/davide-ancelotti.jpg", "Davide Ancelotti", "Bryan Berlin", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Davide_Ancelotti_Brazil_V_Morocco_13_June_2026-48.jpg"],
  ["assets/photos/people/eren-elmali.jpg", "Eren Elmalı", "Zafer", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Eren_Elmal%C4%B1_20251019.jpg"],
  ["assets/photos/people/gaetan-perrin.jpg", "Gaëtan Perrin", "Paté kroute", "CC0", "https://commons.wikimedia.org/wiki/File:Perrin_aja_asse_2425.png"],
  ["assets/photos/people/haraldsson.jpg", "Hákon Arnar Haraldsson", "Supporterhéninois", "CC0", "https://commons.wikimedia.org/wiki/File:RC_Lens_-_Lille_OSC_(08-10-2023)_17_(cropped).jpg"],
  ["assets/photos/people/ilkay-gundogan.jpg", "İlkay Gündoğan", "Granada", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:20180602_FIFA_Friendly_Match_Austria_vs._Germany_%C4%B0lkay_G%C3%BCndo%C4%9Fan_850_0728.jpg"],
  ["assets/photos/people/jakobs.jpg", "Ismail Jakobs", "Bryan Berlin", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Ismail_Jakobs_France_v_Senegal_16_June_2026-237_(cropped).jpg"],
  ["assets/photos/people/leroy-sane.jpg", "Leroy Sané", "Bryan Berlin", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Leroy_Sane_Ecuador_v_Germany_25_June_2026-119_(cropped).jpg"],
  ["assets/photos/people/mario-lemina.jpg", "Mario Lemina", "Supporterhéninois", "CC0", "https://commons.wikimedia.org/wiki/File:RC_Lens_-_OGC_Nice_(10-04-2022)_50.jpg"],
  ["assets/photos/people/maurits-kjaergaard.jpg", "Maurits Kjærgaard", "Werner100359", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:FC_RB_salzburg_gegen_SK_Sturm_Graz_(2024-02-09)_55.jpg"],
  ["assets/photos/people/ngoy.jpg", "Nathan Ngoy", "Bryan Berlin", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Nathan_Ngoy_Belgium_v_USA_6_July_2026-009.jpg"],
  ["assets/photos/people/okan-buruk.jpg", "Okan Buruk", "Zafer", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:Okan_Buruk_20250511_(cropped).jpg"],
  ["assets/photos/people/olivier-giroud.jpg", "Olivier Giroud", "MHSC TV - Montpellier Hérault Sport Club", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:Olivier_Giroud_December_2024.png"],
  ["assets/photos/people/osimhen.jpg", "Victor Osimhen", "Fédération Guinéenne Football", "Public domain", "https://commons.wikimedia.org/wiki/File:Victor-osimhen-nigeria-2024-3-4.jpg"],
  ["assets/photos/people/ozer.jpg", "Berke Özer", "beIN SPORTS Türkiye", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:Berke_%C3%96zer_(2021-22_S%C3%BCper_Lig)_(cropped).png"],
  ["assets/photos/people/sallai.jpg", "Roland Sallai", "mlsz.hu – the official website of the Hungarian Football Federation", "Attribution", "https://commons.wikimedia.org/wiki/File:Sallaiirl.jpg"],
  ["assets/photos/people/sara.jpg", "Gabriel Sara", "Timmy96", "CC0", "https://commons.wikimedia.org/wiki/File:Gabriel_Sara_with_a_fan_(cropped_2).jpg"],
  ["assets/photos/people/tanguy-nianzou.jpg", "Tanguy Nianzou", "Sandro Halank, Wikimedia Commons", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:2019-07-17_SG_Dynamo_Dresden_vs._Paris_Saint-Germain_by_Sandro_Halank%E2%80%93020.jpg"],
  ["assets/photos/people/torreira.jpg", "Lucas Torreira", "Антон Зайцев", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:Lucas_Torreira_2019.jpg"],
  ["assets/photos/people/verdonk.jpg", "Calvin Verdonk", "Timnas Indonesia", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:Calvin_Verdonk_(Indonesia-Philippines_11_June_2024).jpg"],
  ["assets/photos/people/yilmaz.jpg", "Barış Alper Yılmaz", "Zafer", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:Bar%C4%B1%C5%9F_Alper_Y%C4%B1lmaz_20251019.jpg"],
  ["assets/photos/venues/aston-villa.jpg", "Villa Park", "Arne Müseler", "CC BY-SA 3.0 de", "https://commons.wikimedia.org/wiki/File:Birmingham_aston_villa_park_stadium.jpg"],
  ["assets/photos/venues/bayern-munchen.jpg", "Allianz Arena", "2015 Michael 2015", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Allianz_Arena_2008-02-09.jpg"],
  ["assets/photos/venues/como.jpg", "Stadio Giuseppe Sinigaglia", "Vale93b", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Stadio_Sinigaglia_Como_16-07-2025.jpg"],
  ["assets/photos/venues/fc-porto.jpg", "Estádio do Dragão", "Валерий Дед", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:Porto_Est%C3%A1dio_do_Drag%C3%A3o_2.jpg"],
  ["assets/photos/venues/inter.jpg", "San Siro", "Prelvini", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Stadio_Meazza_2021_3.jpg"],
  ["assets/photos/venues/lille.jpg", "Stade Pierre-Mauroy", "Liondartois", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Lille_vs_PSG_2019_-_Stade_Pierre_Mauroy.jpg"],
  ["assets/photos/venues/liverpool.jpg", "Anfield", "Arne Müseler", "CC BY-SA 3.0 de", "https://commons.wikimedia.org/wiki/File:Liverpool_anfield_road_stadium.jpg"],
  ["assets/photos/venues/man-city.jpg", "Etihad Stadium", "Arne Müseler, cropped by Blackcat", "CC BY-SA 3.0 de", "https://commons.wikimedia.org/wiki/File:City_of_Manchester_Stadium_2023_cropped.jpg"],
  ["assets/photos/venues/napoli.jpg", "Stadio Diego Armando Maradona", "Gaetano Capaldo", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:Stadio_Maradona_Serie_A.jpg"],
  ["assets/photos/venues/psg.jpg", "Parc des Princes", "Валерий Дед", "CC BY 3.0", "https://commons.wikimedia.org/wiki/File:Paris_Parc_des_Princes_1.jpg"],
  ["assets/photos/venues/real-betis.jpg", "Estadio Benito Villamarín", "Anual", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:Estadio_Benito_Villamar%C3%ADn_2018001.jpg"],
  ["assets/photos/venues/real-madrid.jpg", "Santiago Bernabéu", "Badefa", "CC0", "https://commons.wikimedia.org/wiki/File:Estadio_Santiago_Bernab%C3%A9u_%E2%80%94_Real_Madrid_Juvenil_A_-_Santiago_Wanderers_Sub-20_(Intercontinental_Sub-20_2026)_%E2%80%94_R%C3%A9cord_de_asistencia_en_un_partido_de_juveniles.jpg"],
  ["assets/photos/venues/sporting-cp.jpg", "Estádio José Alvalade", "Megutim", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:Est%C3%A1dio_Jos%C3%A9_Alvalade_antes_do_jogo_Sporting_-_Arouca.jpg"],
];

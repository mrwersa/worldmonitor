// Pure parsing helpers for the Iran-events domain, extracted from
// scripts/seed-iran-events.mjs so they're safely importable. That script has
// a top-level `if (!IRAN_EVENTS_ENABLED) process.exit(0)` gate (intentional —
// direct `node scripts/seed-iran-events.mjs` runs should no-op cleanly while
// the domain is disabled), which also fires on plain `import`. Keeping the
// side-effect-free logic here — no top-level gate, no Redis, no runSeed —
// means it can be unit-tested (tests/iran-events-country-attribution.test.mjs)
// without tripping that gate or requiring Redis credentials.

export const LOCATION_COORDS = {
  'tehran':        { lat: 35.6892, lon: 51.3890 },
  'isfahan':       { lat: 32.6546, lon: 51.6680 },
  'shiraz':        { lat: 29.5918, lon: 52.5837 },
  'mashhad':       { lat: 36.2605, lon: 59.6168 },
  'tabriz':        { lat: 38.0800, lon: 46.2919 },
  'ahvaz':         { lat: 31.3183, lon: 48.6706 },
  'kermanshah':    { lat: 34.3142, lon: 47.0650 },
  'urmia':         { lat: 37.5527, lon: 45.0761 },
  'bushehr':       { lat: 28.9234, lon: 50.8203 },
  'bandar abbas':  { lat: 27.1865, lon: 56.2808 },
  'erbil':         { lat: 36.1912, lon: 44.0119 },
  'baghdad':       { lat: 33.3152, lon: 44.3661 },
  'basra':         { lat: 30.5085, lon: 47.7804 },
  'mosul':         { lat: 36.3350, lon: 43.1189 },
  'tel aviv':      { lat: 32.0853, lon: 34.7818 },
  'israel':        { lat: 31.7683, lon: 35.2137 },
  'negev':         { lat: 30.8, lon: 34.8 },
  'manama':        { lat: 26.2285, lon: 50.5860 },
  'bahrain':       { lat: 26.0667, lon: 50.5577 },
  'kuwait':        { lat: 29.3759, lon: 47.9774 },
  'dubai':         { lat: 25.2048, lon: 55.2708 },
  'abu dhabi':     { lat: 24.4539, lon: 54.3773 },
  'fujairah':      { lat: 25.1288, lon: 56.3265 },
  'qatar':         { lat: 25.2854, lon: 51.5310 },
  'doha':          { lat: 25.2854, lon: 51.5310 },
  'jordan':        { lat: 31.9454, lon: 35.9284 },
  'irbid':         { lat: 32.5560, lon: 35.8500 },
  'syria':         { lat: 34.8021, lon: 38.9968 },
  'daraa':         { lat: 32.6189, lon: 36.1021 },
  'cyprus':        { lat: 34.7071, lon: 33.0226 },
  'akrotiri':      { lat: 34.5839, lon: 32.9879 },
  'hormuz':        { lat: 27.0, lon: 56.5 },
  'strait of hormuz': { lat: 26.5, lon: 56.3 },
  'parchin':       { lat: 35.5167, lon: 51.7667 },
  'mehrabad':      { lat: 35.6892, lon: 51.3134 },
  'paveh':         { lat: 35.0442, lon: 46.3558 },
  'poldokhtar':    { lat: 33.1517, lon: 47.7133 },
  'azadi':         { lat: 35.6997, lon: 51.3380 },
  'kohak':         { lat: 35.6000, lon: 51.5000 },
  'zibashir':      { lat: 29.55, lon: 52.55 },
  'jam':           { lat: 27.82, lon: 52.35 },
  'london':        { lat: 51.5074, lon: -0.1278 },
  'azerbaijan':    { lat: 40.4093, lon: 49.8671 },
  'baku':          { lat: 40.4093, lon: 49.8671 },
  'gibraltar':     { lat: 36.1408, lon: -5.3536 },
  'iran':          { lat: 32.4279, lon: 53.6880 },
  'iraq':          { lat: 33.2232, lon: 43.6793 },
  'saudi':         { lat: 24.7136, lon: 46.6753 },
  'uae':           { lat: 24.4539, lon: 54.3773 },
  'al udeid':      { lat: 25.1173, lon: 51.3150 },
  'jomhouri':      { lat: 35.6850, lon: 51.4050 },
  'jurf al-sakhar': { lat: 32.9500, lon: 44.1000 },
  'haji omeran':   { lat: 36.6500, lon: 45.0500 },
  'nineveh':       { lat: 36.3500, lon: 43.1500 },
  'rashidiya':     { lat: 36.4000, lon: 43.1000 },
  'gaza':          { lat: 31.3547, lon: 34.3088 },
  'riyadh':        { lat: 24.7136, lon: 46.6753 },
  'sulaimaniyah':  { lat: 35.5613, lon: 45.4306 },
  'sulaimani':     { lat: 35.5613, lon: 45.4306 },
  'haifa':         { lat: 32.7940, lon: 34.9896 },
  'karaj':         { lat: 35.8400, lon: 50.9391 },
  'shahran':       { lat: 35.7900, lon: 51.2900 },
  'kouhak':        { lat: 35.6200, lon: 51.4800 },
  'hamadan':       { lat: 34.7988, lon: 48.5146 },
  'hamedan':       { lat: 34.7988, lon: 48.5146 },
  'yazd':          { lat: 31.8974, lon: 54.3569 },
  'kish':          { lat: 26.5400, lon: 53.9800 },
  'qazvin':        { lat: 36.2688, lon: 50.0041 },
  'najafabad':     { lat: 32.6340, lon: 51.3670 },
  'malayer':       { lat: 34.2968, lon: 48.8234 },
  'mehran':        { lat: 33.1222, lon: 46.1646 },
  'aqaba':         { lat: 29.5267, lon: 35.0078 },
  'eilat':         { lat: 29.5577, lon: 34.9519 },
  'choman':        { lat: 36.6269, lon: 44.8856 },
  'baqer shahr':   { lat: 35.5400, lon: 51.3900 },
  'jubail':        { lat: 27.0046, lon: 49.6225 },
  'shaybah':       { lat: 22.5200, lon: 54.0000 },
  'al dhafra':     { lat: 24.2500, lon: 54.5500 },
  'juffair':       { lat: 26.2167, lon: 50.6000 },
  'qeshm':         { lat: 26.9500, lon: 56.2700 },
  'pakdasht':      { lat: 35.4747, lon: 51.6856 },
  'tasluja':       { lat: 35.5100, lon: 45.3700 },
  'al-kharj':      { lat: 24.1500, lon: 47.3100 },
  'petah tikva':   { lat: 32.0841, lon: 34.8878 },
  'beersheba':     { lat: 31.2518, lon: 34.7913 },
  'oman':          { lat: 23.5880, lon: 58.3829 },
  'oslo':          { lat: 59.9139, lon: 10.7522 },
  'norway':        { lat: 59.9139, lon: 10.7522 },
  'aghdasiyeh':    { lat: 35.7900, lon: 51.4500 },
  'rey':           { lat: 35.5959, lon: 51.4350 },
  'beirut':        { lat: 33.8938, lon: 35.5018 },
  'azraq':         { lat: 31.8300, lon: 36.8300 },
  'yehud':         { lat: 32.0333, lon: 34.8833 },
  'sitra':         { lat: 26.1547, lon: 50.6028 },
  'sanandaj':      { lat: 35.3219, lon: 46.9862 },
  'ma\'ameer':     { lat: 26.0500, lon: 50.5200 },
  'northern cyprus': { lat: 35.1856, lon: 33.3823 },
  'borujerd':      { lat: 33.8973, lon: 48.7516 },
  'lamerd':        { lat: 27.3373, lon: 53.1831 },
  'chabahar':      { lat: 25.2919, lon: 60.6430 },
  'shahrekord':    { lat: 32.3256, lon: 50.8644 },
  'parand':        { lat: 35.4870, lon: 51.0050 },
  'rabat karim':   { lat: 35.4700, lon: 51.0700 },
  'shahriar':      { lat: 35.6569, lon: 51.0592 },
  'punak':         { lat: 35.7600, lon: 51.3600 },
  'bonab':         { lat: 37.3404, lon: 46.0561 },
  'ghaniabad':     { lat: 35.4500, lon: 51.6500 },
  'beit shemesh':  { lat: 31.7469, lon: 34.9876 },
  'bnei brak':     { lat: 32.0833, lon: 34.8333 },
  'quneitra':      { lat: 33.1260, lon: 35.8240 },
  'khan arnabeh':  { lat: 33.1450, lon: 35.8600 },
  'ruwais':        { lat: 24.1100, lon: 52.7300 },
  'mehrshahr':     { lat: 35.8300, lon: 50.9700 },
  'qaim':          { lat: 34.3800, lon: 41.0400 },
  'prince sultan': { lat: 24.0625, lon: 47.5808 },
  'ramat david':   { lat: 32.6650, lon: 35.1792 },
  'vietnam':       { lat: 14.0583, lon: 108.2772 },
  'south korea':   { lat: 35.9078, lon: 127.7669 },
  'ilam':          { lat: 33.6374, lon: 46.4227 },
  'kerman':        { lat: 30.2839, lon: 57.0834 },
  'lorestan':      { lat: 33.4941, lon: 48.3530 },
  'jerusalem':     { lat: 31.7683, lon: 35.2137 },
  'fardis':        { lat: 35.7230, lon: 50.9875 },
  'marivan':       { lat: 35.5269, lon: 46.1761 },
  'salalah':       { lat: 17.0151, lon: 54.0924 },
  'palmachim':     { lat: 31.8970, lon: 34.7000 },
  'umm qasr':      { lat: 30.0362, lon: 47.9298 },
  'al-siba':       { lat: 29.8700, lon: 48.6100 },
  'taleghan':      { lat: 36.1700, lon: 50.7600 },
  'persian gulf':  { lat: 27.0000, lon: 51.5000 },
  'eastern province': { lat: 26.4207, lon: 50.0888 },
  'empty quarter': { lat: 22.5200, lon: 54.0000 },
  'ovadia':        { lat: 31.4700, lon: 34.5300 },
  'shin bet':      { lat: 31.7683, lon: 35.2137 },
  'kharg':         { lat: 29.2635, lon: 50.3273 },
  'qom':           { lat: 34.6401, lon: 50.8764 },
  'andisheh':      { lat: 35.7050, lon: 51.0000 },
  'ankara':        { lat: 39.9334, lon: 32.8597 },
  'minab':         { lat: 27.1452, lon: 57.0812 },
  'asaluyeh':      { lat: 27.4834, lon: 52.6121 },
  'south pars':    { lat: 27.5000, lon: 52.5000 },
  'al-ahmadi':     { lat: 29.0769, lon: 48.0839 },
  'mina al-ahmadi': { lat: 29.0769, lon: 48.0839 },
  'mina abdullah': { lat: 28.9600, lon: 48.1600 },
  'kafr qasim':    { lat: 32.1161, lon: 34.9750 },
  'taybad':        { lat: 35.1884, lon: 60.7814 },
  'sweihan':       { lat: 24.4041, lon: 55.3325 },
  'mahshahr':      { lat: 30.5630, lon: 49.1980 },
  'bandar khamir': { lat: 26.9592, lon: 55.8981 },
  'shalamcheh':    { lat: 30.5244, lon: 47.9297 },
  'ramat gan':     { lat: 32.0704, lon: 34.8237 },
  'shuwaikh':      { lat: 29.3636, lon: 47.9417 },
};

// ISO-3166 alpha-2 attribution per LOCATION_COORDS key, for Alert Rule
// Country Scope matching (see scripts/notification-relay.cjs
// eventMatchesCountryScope). Chokepoint/international-waters entries
// (Hormuz, Persian Gulf) are deliberately omitted — they attribute to no
// single state and fall through to the unattributed branch there, which
// this domain's eventType is NOT on the news-permissive allowlist for, so
// those events are dropped for country-scoped rules rather than guessed.
export const LOCATION_COUNTRY = {
  // Iran
  tehran: 'IR', isfahan: 'IR', shiraz: 'IR', mashhad: 'IR', tabriz: 'IR', ahvaz: 'IR',
  kermanshah: 'IR', urmia: 'IR', bushehr: 'IR', 'bandar abbas': 'IR', parchin: 'IR',
  mehrabad: 'IR', paveh: 'IR', poldokhtar: 'IR', azadi: 'IR', kohak: 'IR', zibashir: 'IR',
  jam: 'IR', iran: 'IR', jomhouri: 'IR', karaj: 'IR', shahran: 'IR', kouhak: 'IR',
  hamadan: 'IR', hamedan: 'IR', yazd: 'IR', kish: 'IR', qazvin: 'IR', najafabad: 'IR',
  malayer: 'IR', mehran: 'IR', 'baqer shahr': 'IR', qeshm: 'IR', pakdasht: 'IR',
  aghdasiyeh: 'IR', rey: 'IR', sanandaj: 'IR', borujerd: 'IR', lamerd: 'IR',
  chabahar: 'IR', shahrekord: 'IR', parand: 'IR', 'rabat karim': 'IR', shahriar: 'IR',
  punak: 'IR', bonab: 'IR', ghaniabad: 'IR', mehrshahr: 'IR', ilam: 'IR', kerman: 'IR',
  lorestan: 'IR', fardis: 'IR', marivan: 'IR', taleghan: 'IR', kharg: 'IR', qom: 'IR',
  andisheh: 'IR', minab: 'IR', asaluyeh: 'IR', 'south pars': 'IR', taybad: 'IR',
  mahshahr: 'IR', 'bandar khamir': 'IR', shalamcheh: 'IR',
  // Israel
  'tel aviv': 'IL', israel: 'IL', negev: 'IL', jerusalem: 'IL', 'beit shemesh': 'IL',
  'bnei brak': 'IL', 'kafr qasim': 'IL', 'ramat gan': 'IL', 'petah tikva': 'IL',
  beersheba: 'IL', eilat: 'IL', yehud: 'IL', 'ramat david': 'IL', palmachim: 'IL',
  haifa: 'IL', ovadia: 'IL', 'shin bet': 'IL',
  // Iraq
  erbil: 'IQ', baghdad: 'IQ', basra: 'IQ', mosul: 'IQ', 'jurf al-sakhar': 'IQ',
  'haji omeran': 'IQ', nineveh: 'IQ', rashidiya: 'IQ', sulaimaniyah: 'IQ',
  sulaimani: 'IQ', qaim: 'IQ', 'umm qasr': 'IQ', 'al-siba': 'IQ', choman: 'IQ',
  tasluja: 'IQ', iraq: 'IQ',
  // Gulf states
  manama: 'BH', bahrain: 'BH', juffair: 'BH', sitra: 'BH', "ma'ameer": 'BH',
  kuwait: 'KW', 'al-ahmadi': 'KW', 'mina al-ahmadi': 'KW', 'mina abdullah': 'KW', shuwaikh: 'KW',
  dubai: 'AE', 'abu dhabi': 'AE', fujairah: 'AE', 'al dhafra': 'AE', sweihan: 'AE', ruwais: 'AE', uae: 'AE',
  qatar: 'QA', doha: 'QA', 'al udeid': 'QA',
  saudi: 'SA', riyadh: 'SA', jubail: 'SA', shaybah: 'SA', 'al-kharj': 'SA',
  'eastern province': 'SA', 'empty quarter': 'SA', 'prince sultan': 'SA',
  oman: 'OM', salalah: 'OM',
  // Levant / neighbors
  jordan: 'JO', irbid: 'JO', azraq: 'JO', aqaba: 'JO',
  syria: 'SY', daraa: 'SY', quneitra: 'SY', 'khan arnabeh': 'SY',
  gaza: 'PS', beirut: 'LB',
  // Other
  cyprus: 'CY', akrotiri: 'CY', 'northern cyprus': 'CY',
  azerbaijan: 'AZ', baku: 'AZ',
  gibraltar: 'GI', london: 'GB', ankara: 'TR', oslo: 'NO', norway: 'NO',
  vietnam: 'VN', 'south korea': 'KR',
};

export const CATEGORY_MAP = {
  cat1: 'military',
  cat2: 'international',
  cat6: 'political',
  cat7: 'civil',
  cat9: 'intelligence',
  cat10: 'airstrike',
  cat11: 'defense',
};

export function geolocate(title) {
  const lower = title.toLowerCase();
  for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
    if (lower.includes(name)) return { ...coords, locationName: name, country: LOCATION_COUNTRY[name] ?? null };
  }
  return { lat: 32.4279, lon: 53.6880, locationName: 'Iran', country: 'IR' };
}

export function categorizeSeverity(title) {
  const lower = title.toLowerCase();
  if (/killed|dead|casualties|death toll|wounded/.test(lower)) return 'critical';
  if (/airstrike|bombing|missile|explosion|struck|destroyed/.test(lower)) return 'high';
  if (/intercept|defense|sirens|alert/.test(lower)) return 'elevated';
  return 'moderate';
}

export function parseRelativeTime(timeStr) {
  const now = Date.now();
  const match = timeStr.match(/(\d+)\s+hours?\s+ago/);
  if (match) return now - parseInt(match[1], 10) * 3600_000;
  const minMatch = timeStr.match(/(\d+)\s+min/);
  if (minMatch) return now - parseInt(minMatch[1], 10) * 60_000;
  if (/a day ago/.test(timeStr)) return now - 86400_000;
  const dayMatch = timeStr.match(/(\d+)\s+days?\s+ago/);
  if (dayMatch) return now - parseInt(dayMatch[1], 10) * 86400_000;
  return now;
}

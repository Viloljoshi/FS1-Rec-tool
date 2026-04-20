// Public identifiers and reference data for seed generation.
// Tickers, ISINs, CUSIPs, and broker names here are all real public data.

export interface SecurityRef {
  symbol: string;
  isin: string;
  cusip: string;
  name: string;
  baseline_close: number;
  adv: number;
}

export const SECURITIES: SecurityRef[] = [
  { symbol: 'AAPL',  isin: 'US0378331005', cusip: '037833100', name: 'Apple Inc.',              baseline_close: 178.42, adv: 55_000_000 },
  { symbol: 'MSFT',  isin: 'US5949181045', cusip: '594918104', name: 'Microsoft Corporation',    baseline_close: 412.17, adv: 22_000_000 },
  { symbol: 'NVDA',  isin: 'US67066G1040', cusip: '67066G104', name: 'NVIDIA Corporation',       baseline_close: 895.22, adv: 46_000_000 },
  { symbol: 'GOOGL', isin: 'US02079K3059', cusip: '02079K305', name: 'Alphabet Inc. Class A',    baseline_close: 148.83, adv: 26_000_000 },
  { symbol: 'AMZN',  isin: 'US0231351067', cusip: '023135106', name: 'Amazon.com, Inc.',         baseline_close: 185.06, adv: 42_000_000 },
  { symbol: 'META',  isin: 'US30303M1027', cusip: '30303M102', name: 'Meta Platforms Inc.',      baseline_close: 513.72, adv: 14_000_000 },
  { symbol: 'TSLA',  isin: 'US88160R1014', cusip: '88160R101', name: 'Tesla, Inc.',              baseline_close: 177.58, adv: 88_000_000 },
  { symbol: 'LLY',   isin: 'US5324571083', cusip: '532457108', name: 'Eli Lilly and Company',    baseline_close: 775.41, adv:  3_200_000 },
  { symbol: 'V',     isin: 'US92826C8394', cusip: '92826C839', name: 'Visa Inc. Class A',        baseline_close: 281.12, adv:  6_800_000 },
  { symbol: 'JPM',   isin: 'US46625H1005', cusip: '46625H100', name: 'JPMorgan Chase & Co.',     baseline_close: 197.52, adv: 10_000_000 },
  { symbol: 'XOM',   isin: 'US30231G1022', cusip: '30231G102', name: 'Exxon Mobil Corporation',  baseline_close: 119.38, adv: 16_000_000 },
  { symbol: 'UNH',   isin: 'US91324P1021', cusip: '91324P102', name: 'UnitedHealth Group Inc.',  baseline_close: 512.28, adv:  3_600_000 },
  { symbol: 'MA',    isin: 'US57636Q1040', cusip: '57636Q104', name: 'Mastercard Incorporated',  baseline_close: 476.17, adv:  2_800_000 },
  { symbol: 'HD',    isin: 'US4370761029', cusip: '437076102', name: 'The Home Depot, Inc.',     baseline_close: 351.42, adv:  3_500_000 },
  { symbol: 'PG',    isin: 'US7427181091', cusip: '742718109', name: 'Procter & Gamble Co.',     baseline_close: 162.08, adv:  7_200_000 },
  { symbol: 'COST',  isin: 'US22160K1051', cusip: '22160K105', name: 'Costco Wholesale Corp.',   baseline_close: 730.55, adv:  2_100_000 },
  { symbol: 'JNJ',   isin: 'US4781601046', cusip: '478160104', name: 'Johnson & Johnson',        baseline_close: 154.27, adv:  6_500_000 },
  { symbol: 'ABBV',  isin: 'US00287Y1091', cusip: '00287Y109', name: 'AbbVie Inc.',              baseline_close: 174.95, adv:  7_000_000 },
  { symbol: 'WMT',   isin: 'US9311421039', cusip: '931142103', name: 'Walmart Inc.',             baseline_close:  60.21, adv: 20_000_000 },
  { symbol: 'KO',    isin: 'US1912161007', cusip: '191216100', name: 'The Coca-Cola Company',    baseline_close:  60.74, adv: 13_000_000 }
];

export interface BrokerRef {
  canonical: string;
  sec_crd: string;
  aliases: string[];
  country: string;
}

export const BROKERS: BrokerRef[] = [
  {
    canonical: 'Goldman Sachs & Co. LLC',
    sec_crd: '361',
    country: 'US',
    aliases: ['Goldman Sachs', 'GS & Co', 'GOLDMAN SACHS & CO LLC', 'GS', 'Goldman, Sachs & Co.']
  },
  {
    canonical: 'J.P. Morgan Securities LLC',
    sec_crd: '79',
    country: 'US',
    aliases: ['JPM Securities', 'JPM Sec.', 'JPMorgan Sec LLC', 'J P MORGAN SECURITIES LLC', 'JPMCB', 'JPMorgan']
  },
  {
    canonical: 'Morgan Stanley & Co. LLC',
    sec_crd: '8209',
    country: 'US',
    aliases: ['Morgan Stanley', 'MS & Co', 'MS', 'MORGAN STANLEY & CO LLC', 'Morgan Stanley Co']
  },
  {
    canonical: 'Citigroup Global Markets Inc.',
    sec_crd: '7059',
    country: 'US',
    aliases: ['Citi', 'Citigroup', 'CGMI', 'CITI GLOBAL MARKETS', 'Citi Global Markets']
  },
  {
    canonical: 'Merrill Lynch, Pierce, Fenner & Smith Incorporated',
    sec_crd: '7691',
    country: 'US',
    aliases: ['Merrill', 'BofA Securities', 'MLPFS', 'BofA Sec', 'Merrill Lynch']
  },
  {
    canonical: 'Jefferies LLC',
    sec_crd: '2347',
    country: 'US',
    aliases: ['Jefferies', 'JEFF', 'JEFFERIES LLC']
  },
  {
    canonical: 'Jane Street Capital LLC',
    sec_crd: '155117',
    country: 'US',
    aliases: ['Jane Street', 'JSC', 'JANE STREET']
  },
  {
    canonical: 'Virtu Americas LLC',
    sec_crd: '149262',
    country: 'US',
    aliases: ['Virtu', 'VIRTU', 'VIRTU AMERICAS', 'Virtu Financial']
  },
  {
    canonical: 'Barclays Capital Inc.',
    sec_crd: '19714',
    country: 'US',
    aliases: ['Barclays', 'BARC', 'BARCLAYS CAPITAL']
  },
  {
    canonical: 'UBS Securities LLC',
    sec_crd: '7654',
    country: 'US',
    aliases: ['UBS', 'UBS SECURITIES LLC', 'UBS Sec']
  }
];

export const ACCOUNTS: string[] = [
  'ACCT-4421',
  'ACCT-5518',
  'ACCT-6602',
  'ACCT-7731',
  'ACCT-8845'
];

// 5 real trading days (US, business days only). Output files from
// fetch-real-prices.ts override these with Yahoo-sourced close prices.
export const TRADING_DATES: string[] = [
  '2026-04-06',
  '2026-04-07',
  '2026-04-08',
  '2026-04-09',
  '2026-04-10'
];

// T+1 settlement: next business day
export function settlementDate(tradeDate: string): string {
  const d = new Date(tradeDate);
  d.setUTCDate(d.getUTCDate() + 1);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2); // Sat → Mon
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun → Mon
  return d.toISOString().slice(0, 10);
}

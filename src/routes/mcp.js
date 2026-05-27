const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const BLS_INFLATION_SERIES = {
  all_items: 'CUUR0000SA0', core: 'CUUR0000SA0L1E', food: 'CUUR0000SAF1',
  energy: 'CUUR0000SA0E', shelter: 'CUUR0000SAH1', medical: 'CUUR0000SAM'
};

const BLS_JOBS_SERIES = {
  unemployment_rate: 'LNS14000000', nonfarm_payrolls: 'CES0000000001',
  job_openings: 'JTS000000000000000JOL', avg_hourly_earnings: 'CES0500000003',
  labor_force_participation: 'LNS11300000'
};

const FRED_SERIES = {
  gdp: 'GDP', fed_funds_rate: 'FEDFUNDS', treasury_10y: 'DGS10',
  treasury_2y: 'DGS2', yield_curve: 'T10Y2Y', housing_starts: 'HOUST',
  retail_sales: 'RSAFS', consumer_sentiment: 'UMCSENT'
};

const EIA_SERIES = {
  wti_crude: { facets: { series: 'RWTC' }, dataset: 'petroleum/pri/spt', desc: 'WTI Crude Oil ($/barrel)' },
  brent_crude: { facets: { series: 'RBRTE' }, dataset: 'petroleum/pri/spt', desc: 'Brent Crude Oil ($/barrel)' },
  natural_gas: { facets: { series: 'RNGWHHD' }, dataset: 'natural-gas/pri/sum', desc: 'Natural Gas Henry Hub ($/MMBtu)' },
};

const TOOLS = [
  {
    name: 'get_inflation',
    description: 'Get U.S. CPI inflation data from the Bureau of Labor Statistics. Returns latest value, YoY change, and MoM change.',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'all_items (default), core (ex food/energy), food, energy, shelter, medical', default: 'all_items' },
        months: { type: 'number', description: 'Months of history (default 13)', default: 13 }
      }
    }
  },
  {
    name: 'get_jobs',
    description: 'Get U.S. labor market data from BLS. Unemployment rate, nonfarm payrolls, job openings, and wages.',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'unemployment_rate (default), nonfarm_payrolls, job_openings, avg_hourly_earnings, labor_force_participation', default: 'unemployment_rate' },
        months: { type: 'number', description: 'Months of history', default: 13 }
      }
    }
  },
  {
    name: 'get_macro',
    description: 'Get macroeconomic indicators from FRED (Federal Reserve). GDP, Fed funds rate, Treasury yields, housing starts, retail sales.',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'gdp, fed_funds_rate (default), treasury_10y, treasury_2y, yield_curve, housing_starts, retail_sales, consumer_sentiment', default: 'fed_funds_rate' },
        limit: { type: 'number', description: 'Data points to return', default: 12 }
      }
    }
  },
  {
    name: 'get_energy',
    description: 'Get energy prices from the U.S. Energy Information Administration. WTI crude, Brent crude, natural gas.',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'wti_crude (default), brent_crude, natural_gas', default: 'wti_crude' },
        limit: { type: 'number', description: 'Weekly data points', default: 12 }
      }
    }
  }
,
  {
    name: 'get_treasury',
    description: 'Get U.S. national debt (daily, to the penny) and average interest rates on Treasury securities from the U.S. Treasury.',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'debt (national debt, default) or interest_rates', default: 'debt' },
        limit: { type: 'number', description: 'Number of records', default: 10 }
      }
    }
  },
  {
    name: 'get_demographics',
    description: 'Get U.S. Census demographic data by state or county. Population, median income, poverty rate, unemployment, home values, and education level.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: '2-letter state code (CA, TX, NY). Omit for all states.' },
        level: { type: 'string', description: 'state (default) or county', default: 'state' }
      }
    }
  }
,
  {
    name: 'get_business_patterns',
    description: 'U.S. County Business Patterns — number of businesses (establishments), employees, and payroll by industry (NAICS code) and state. Answers: How many tech companies in California? Total healthcare employees in Texas?',
    inputSchema: {
      type: 'object',
      properties: {
        naics: { type: 'string', description: 'NAICS industry code: 51=Tech/Info, 52=Finance, 53=Real Estate, 54=Professional Services, 62=Healthcare, 23=Construction, 44=Retail, 72=Food/Hospitality', default: '51' },
        state: { type: 'string', description: '2-letter state code (CA, TX, NY). Omit for all states.' },
        year: { type: 'string', description: 'Data year (default: 2021)', default: '2021' }
      }
    }
  }
];

async function executeTool(name, args) {
  switch (name) {
    case 'get_inflation': {
      const seriesId = BLS_INFLATION_SERIES[args.series || 'all_items'] || BLS_INFLATION_SERIES.all_items;
      const cacheKey = `mcp:infl:${seriesId}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const { data } = await axios.get(`https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`, { headers: { 'User-Agent': 'AgentEcon/1.0' }, timeout: 10000 });
      const sorted = (data.Results?.series?.[0]?.data || []).sort((a,b) => `${b.year}${b.period}`.localeCompare(`${a.year}${a.period}`));
      const latest = parseFloat(sorted[0]?.value), yearAgo = parseFloat(sorted[12]?.value), prev = parseFloat(sorted[1]?.value);
      const result = { success: true, series: args.series || 'all_items', latest_value: latest, latest_period: `${sorted[0]?.periodName} ${sorted[0]?.year}`, yoy_change_pct: yearAgo ? Math.round(((latest-yearAgo)/yearAgo)*10000)/100 : null, mom_change_pct: prev ? Math.round(((latest-prev)/prev)*10000)/100 : null, history: sorted.slice(0, args.months || 6).map(d=>({month:`${d.periodName} ${d.year}`, value:parseFloat(d.value)})), source: 'BLS', disclaimer: 'Information only.' };
      cache.set(cacheKey, result);
      return result;
    }
    case 'get_jobs': {
      const seriesId = BLS_JOBS_SERIES[args.series || 'unemployment_rate'] || BLS_JOBS_SERIES.unemployment_rate;
      const cacheKey = `mcp:jobs:${seriesId}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const { data } = await axios.get(`https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`, { headers: { 'User-Agent': 'AgentEcon/1.0' }, timeout: 10000 });
      const sorted = (data.Results?.series?.[0]?.data || []).sort((a,b) => `${b.year}${b.period}`.localeCompare(`${a.year}${a.period}`));
      const latest = parseFloat(sorted[0]?.value), prev = parseFloat(sorted[1]?.value), yearAgo = parseFloat(sorted[12]?.value);
      const result = { success: true, series: args.series || 'unemployment_rate', latest_value: latest, latest_period: `${sorted[0]?.periodName} ${sorted[0]?.year}`, mom_change: prev ? Math.round((latest-prev)*100)/100 : null, yoy_change: yearAgo ? Math.round((latest-yearAgo)*100)/100 : null, history: sorted.slice(0, args.months || 6).map(d=>({month:`${d.periodName} ${d.year}`, value:parseFloat(d.value)})), source: 'BLS', disclaimer: 'Information only.' };
      cache.set(cacheKey, result);
      return result;
    }
    case 'get_macro': {
      const FRED_KEY = process.env.FRED_API_KEY;
      if (!FRED_KEY) return { error: 'FRED API key not configured' };
      const seriesId = FRED_SERIES[args.series || 'fed_funds_rate'] || FRED_SERIES.fed_funds_rate;
      const cacheKey = `mcp:macro:${seriesId}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const { data } = await axios.get('https://api.stlouisfed.org/fred/series/observations', { params: { series_id: seriesId, api_key: FRED_KEY, file_type: 'json', limit: args.limit || 12, sort_order: 'desc' }, timeout: 10000 });
      const obs = (data.observations || []).filter(o => o.value !== '.');
      const result = { success: true, series: args.series || 'fed_funds_rate', latest_value: parseFloat(obs[0]?.value), latest_date: obs[0]?.date, previous_value: parseFloat(obs[1]?.value), change: obs[1] ? Math.round((parseFloat(obs[0]?.value)-parseFloat(obs[1]?.value))*100)/100 : null, history: obs.slice(0, args.limit||12).map(o=>({date:o.date,value:parseFloat(o.value)})), source: 'FRED', disclaimer: 'Information only.' };
      cache.set(cacheKey, result);
      return result;
    }
    case 'get_energy': {
      const EIA_KEY = process.env.EIA_API_KEY;
      if (!EIA_KEY) return { error: 'EIA API key not configured' };
      const s = EIA_SERIES[args.series || 'wti_crude'] || EIA_SERIES.wti_crude;
      const cacheKey = `mcp:energy:${args.series}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const facetParams = Object.entries(s.facets).map(([k,v]) => `facets[${k}][]=${encodeURIComponent(v)}`).join('&');
      const url = `https://api.eia.gov/v2/${s.dataset}/data/?api_key=${EIA_KEY}&frequency=weekly&data[0]=value&length=${args.limit||12}&${facetParams}`;
      const { data } = await axios.get(url, { timeout: 10000 });
      const obs = data.response?.data || [];
      const result = { success: true, series: args.series || 'wti_crude', description: s.desc, latest_value: parseFloat(obs[0]?.value), latest_period: obs[0]?.period, change: obs[1] ? Math.round((parseFloat(obs[0]?.value)-parseFloat(obs[1]?.value))*100)/100 : null, history: obs.slice(0,args.limit||8).map(o=>({period:o.period,value:parseFloat(o.value)})), source: 'EIA', disclaimer: 'Information only.' };
      cache.set(cacheKey, result);
      return result;
    }

    case 'get_treasury': {
      const { series = 'debt', limit = 10 } = args;
      const BASE_URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2';
      if (series === 'debt') {
        const { data } = await axios.get(`${BASE_URL}/accounting/od/debt_to_penny`, { params: { limit: Math.min(limit,30), sort:'-record_date', fields:'record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt' }, timeout:10000 });
        const r = data.data?.[0];
        return { success:true, series:'debt', latest_date:r?.record_date, total_debt_trillions: Math.round(parseFloat(r?.tot_pub_debt_out_amt)/1e12*100)/100, debt_held_by_public: Math.round(parseFloat(r?.debt_held_public_amt)/1e12*100)/100, intragovernmental: Math.round(parseFloat(r?.intragov_hold_amt)/1e12*100)/100, source:'U.S. Treasury' };
      } else {
        const { data } = await axios.get(`${BASE_URL}/accounting/od/avg_interest_rates`, { params: { limit: Math.min(limit,30), sort:'-record_date', fields:'record_date,security_type_desc,security_desc,avg_interest_rate_amt' }, timeout:10000 });
        return { success:true, series:'interest_rates', latest_date:data.data?.[0]?.record_date, rates:(data.data||[]).slice(0,10).map(r=>({ security:r.security_desc||r.security_type_desc, rate:parseFloat(r.avg_interest_rate_amt) })), source:'U.S. Treasury' };
      }
    }
    case 'get_demographics': {
      const CENSUS_KEY = process.env.CENSUS_API_KEY;
      if (!CENSUS_KEY) return { error: 'Census API key not configured' };
      const { state, level = 'state' } = args;
      const STATE_FIPS = {'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28','MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36','NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45','SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54','WI':'55','WY':'56','DC':'11'};
      const vars = 'B01001_001E,B01002_001E,B19013_001E,B19301_001E,B25077_001E,B25064_001E';
      const params = { get:`NAME,${vars}`, key:CENSUS_KEY };
      if (state) { const fips = STATE_FIPS[state.toUpperCase()]||state; params['for']=`state:${fips}`; } else { params['for']='state:*'; }
      const { data:rawData } = await axios.get('https://api.census.gov/data/2022/acs/acs5', { params, timeout:15000 });
      const [headers,...rows] = rawData;
      const results = rows.map(row => { const obj={}; headers.forEach((h,i)=>obj[h]=row[i]); return { name:obj.NAME, population:parseInt(obj['B01001_001E']), median_age:parseFloat(obj['B01002_001E']), median_household_income:parseInt(obj['B19013_001E']), per_capita_income:parseInt(obj['B19301_001E']), median_home_value:parseInt(obj['B25077_001E']), median_rent:parseInt(obj['B25064_001E']) }; });
      return { success:true, year:'2022 ACS 5-Year', count:results.length, data:results, source:'U.S. Census Bureau' };
    }

    case 'get_business_patterns': {
      const CENSUS_KEY = process.env.CENSUS_API_KEY;
      if (!CENSUS_KEY) return { error: 'Census API key not configured' };
      const { naics = '51', state, year = '2021' } = args;
      const STATE_FIPS = {'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28','MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36','NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45','SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54','WI':'55','WY':'56','DC':'11'};
      const fipsToState = Object.entries(STATE_FIPS).reduce((a,[k,v])=>{a[v]=k;return a;},{});
      const fips = state ? (STATE_FIPS[state.toUpperCase()]||state) : '*';
      const { data } = await axios.get(`https://api.census.gov/data/${year}/cbp`, { params: { get:'NAICS2017,NAICS2017_LABEL,ESTAB,EMP,PAYANN', for: fips==='*'?'state:*':`state:${fips}`, key:CENSUS_KEY, NAICS2017:naics }, timeout:15000 });
      const [headers,...rows] = data;
      const results = rows.map(row=>{ const o={}; headers.forEach((h,i)=>o[h]=row[i]); return { state:fipsToState[o.state]||o.state, industry:o.NAICS2017_LABEL||naics, establishments:parseInt(o.ESTAB)||0, employees:parseInt(o.EMP)||0, avg_salary:o.EMP>0?Math.round((parseInt(o.PAYANN)*1000)/parseInt(o.EMP)):null }; }).filter(r=>r.establishments>0).sort((a,b)=>b.employees-a.employees);
      const totalEstab = results.reduce((s,r)=>s+r.establishments,0);
      const totalEmp = results.reduce((s,r)=>s+r.employees,0);
      return { success:true, year, naics_code:naics, industry:results[0]?.industry, state_filter:state||'All States', totals:{ establishments:totalEstab, employees:totalEmp }, top_states:results.slice(0,10), source:'U.S. Census Bureau — County Business Patterns' };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({ name: 'AgentEcon', version: '1.0.0', transport: 'http', protocol: 'mcp', tools: ['get_inflation', 'get_jobs', 'get_macro', 'get_energy', 'get_treasury', 'get_demographics', 'get_business_patterns'] });
});

router.post('/', async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize': result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'AgentEcon', version: '1.0.0' } }; break;
      case 'tools/list': result = { tools: TOOLS }; break;
      case 'tools/call': { const { name, arguments: a = {} } = params; result = { content: [{ type: 'text', text: JSON.stringify(await executeTool(name, a), null, 2) }] }; break; }
      case 'ping': result = {}; break;
      default: return res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
    }
    res.json({ jsonrpc: '2.0', result, id });
  } catch (err) {
    res.json({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id });
  }
});

module.exports = router;

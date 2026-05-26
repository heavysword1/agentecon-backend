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
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({ name: 'AgentEcon', version: '1.0.0', transport: 'http', protocol: 'mcp', tools: ['get_inflation', 'get_jobs', 'get_macro', 'get_energy'] });
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

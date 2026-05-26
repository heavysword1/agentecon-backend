const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const EIA_SERIES = {
  wti_crude: { facets: { series: 'RWTC' }, dataset: 'petroleum/pri/spt', desc: 'WTI Crude Oil Spot Price ($/barrel)', freq: 'weekly' },
  brent_crude: { facets: { series: 'RBRTE' }, dataset: 'petroleum/pri/spt', desc: 'Brent Crude Oil Spot Price ($/barrel)', freq: 'weekly' },
  natural_gas: { facets: { series: 'RNGWHHD' }, dataset: 'natural-gas/pri/sum', desc: 'Natural Gas Henry Hub Spot Price ($/MMBtu)', freq: 'weekly' },
  gasoline: { facets: { 'duoarea': 'NUS', 'product': 'EPM0', 'process': 'PTE' }, dataset: 'petroleum/pri/gnd', desc: 'U.S. Regular Gasoline Retail Price ($/gallon)', freq: 'weekly' },
};

router.get('/', async (req, res) => {
  try {
    const EIA_KEY = process.env.EIA_API_KEY;
    if (!EIA_KEY) return res.status(503).json({ error: 'EIA API key not configured', available_series: Object.keys(EIA_SERIES), register: 'https://www.eia.gov/opendata/register.php' });

    const { series = 'wti_crude', limit = 12 } = req.query;
    const seriesInfo = EIA_SERIES[series];
    if (!seriesInfo) return res.status(400).json({ error: `Unknown series. Available: ${Object.keys(EIA_SERIES).join(', ')}` });

    const cacheKey = `energy:${series}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Build query string manually for proper bracket notation
    const baseParams = `api_key=${EIA_KEY}&frequency=${seriesInfo.freq}&data[0]=value&length=${parseInt(limit) || 12}`;
    const facetParams = Object.entries(seriesInfo.facets || {}).map(([k,v]) => `facets[${k}][]=${encodeURIComponent(v)}`).join('&');
    const url = `https://api.eia.gov/v2/${seriesInfo.dataset}/data/?${baseParams}&${facetParams}`;

    const { data } = await axios.get(url, { timeout: 10000 });

    const observations = (data.response?.data || []).filter(o => o.value);
    const latest = observations[0];
    const prev = observations[1];

    const result = {
      success: true,
      series,
      description: seriesInfo.desc,
      frequency: seriesInfo.freq,
      latest_value: parseFloat(latest?.value),
      latest_period: latest?.period,
      previous_value: parseFloat(prev?.value),
      change: prev ? Math.round((parseFloat(latest?.value) - parseFloat(prev?.value)) * 100) / 100 : null,
      change_pct: prev ? Math.round(((parseFloat(latest?.value) - parseFloat(prev?.value)) / parseFloat(prev?.value)) * 10000) / 100 : null,
      available_series: Object.keys(EIA_SERIES),
      history: observations.slice(0, parseInt(limit) || 12).map(o => ({ period: o.period, value: parseFloat(o.value) })),
      source: 'U.S. Energy Information Administration (EIA)',
      disclaimer: 'Information only. Data subject to revision.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 1hr - CPI updated monthly

// BLS series IDs
const SERIES = {
  all_items: 'CUUR0000SA0',        // CPI-U All Items
  core: 'CUUR0000SA0L1E',          // Core CPI (ex food & energy)
  food: 'CUUR0000SAF1',            // Food
  energy: 'CUUR0000SA0E',          // Energy
  shelter: 'CUUR0000SAH1',         // Shelter/Housing
  medical: 'CUUR0000SAM',          // Medical Care
};

router.get('/', async (req, res) => {
  try {
    const { series = 'all_items', months = 13 } = req.query;
    const seriesId = SERIES[series] || SERIES.all_items;
    const cacheKey = `inflation:${seriesId}:${months}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const currentYear = new Date().getFullYear();
    const { data } = await axios.get(`https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`, {
      headers: { 'User-Agent': 'AgentEcon/1.0 (econ.memoryapi.org)' }, timeout: 10000
    });

    if (data.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS API error');

    const series_data = data.Results?.series?.[0]?.data || [];
    const sorted = series_data.sort((a, b) => `${b.year}${b.period}`.localeCompare(`${a.year}${a.period}`));
    const recent = sorted.slice(0, parseInt(months) || 13);

    // Calculate YoY inflation
    const latest = parseFloat(recent[0]?.value);
    const yearAgo = parseFloat(recent[12]?.value);
    const yoy_pct = yearAgo ? Math.round(((latest - yearAgo) / yearAgo) * 10000) / 100 : null;

    // MoM change
    const prevMonth = parseFloat(recent[1]?.value);
    const mom_pct = prevMonth ? Math.round(((latest - prevMonth) / prevMonth) * 10000) / 100 : null;

    const result = {
      success: true,
      series,
      series_description: { all_items: 'CPI-U All Items', core: 'Core CPI (ex food & energy)', food: 'Food', energy: 'Energy', shelter: 'Shelter/Housing', medical: 'Medical Care' }[series] || series,
      latest_value: latest,
      latest_period: `${recent[0]?.periodName} ${recent[0]?.year}`,
      yoy_change_pct: yoy_pct,
      mom_change_pct: mom_pct,
      available_series: Object.keys(SERIES),
      history: recent.map(d => ({ year: d.year, month: d.periodName, value: parseFloat(d.value) })),
      source: 'U.S. Bureau of Labor Statistics (BLS)',
      disclaimer: 'Information only. Data subject to revision.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

// FRED series IDs (St. Louis Federal Reserve)
const FRED_SERIES = {
  gdp: { id: 'GDP', desc: 'Gross Domestic Product (Billions USD, Seasonally Adjusted Annual Rate)', freq: 'Quarterly' },
  fed_funds_rate: { id: 'FEDFUNDS', desc: 'Federal Funds Effective Rate (%)', freq: 'Monthly' },
  treasury_10y: { id: 'DGS10', desc: '10-Year Treasury Constant Maturity Rate (%)', freq: 'Daily' },
  treasury_2y: { id: 'DGS2', desc: '2-Year Treasury Constant Maturity Rate (%)', freq: 'Daily' },
  yield_curve: { id: 'T10Y2Y', desc: '10-Year minus 2-Year Treasury Spread (basis points)', freq: 'Daily' },
  housing_starts: { id: 'HOUST', desc: 'Housing Starts (Thousands of Units)', freq: 'Monthly' },
  retail_sales: { id: 'RSAFS', desc: 'Advance Retail Sales (Millions USD)', freq: 'Monthly' },
  consumer_sentiment: { id: 'UMCSENT', desc: 'University of Michigan Consumer Sentiment', freq: 'Monthly' },
  m2_money_supply: { id: 'M2SL', desc: 'M2 Money Supply (Billions USD)', freq: 'Monthly' },
  industrial_production: { id: 'INDPRO', desc: 'Industrial Production Index', freq: 'Monthly' }
};

router.get('/', async (req, res) => {
  try {
    const FRED_KEY = process.env.FRED_API_KEY;
    if (!FRED_KEY) return res.status(503).json({ error: 'FRED API key not configured', available_series: Object.keys(FRED_SERIES) });

    const { series = 'gdp', limit = 12 } = req.query;
    const seriesInfo = FRED_SERIES[series];
    if (!seriesInfo) return res.status(400).json({ error: `Unknown series. Available: ${Object.keys(FRED_SERIES).join(', ')}` });

    const cacheKey = `macro:${series}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { data } = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
      params: { series_id: seriesInfo.id, api_key: FRED_KEY, file_type: 'json', limit: parseInt(limit) || 12, sort_order: 'desc' },
      timeout: 10000
    });

    const observations = (data.observations || []).filter(o => o.value !== '.');
    const latest = observations[0];
    const prev = observations[1];

    const result = {
      success: true,
      series,
      description: seriesInfo.desc,
      frequency: seriesInfo.freq,
      latest_value: parseFloat(latest?.value),
      latest_date: latest?.date,
      previous_value: parseFloat(prev?.value),
      change: prev ? Math.round((parseFloat(latest?.value) - parseFloat(prev?.value)) * 100) / 100 : null,
      available_series: Object.keys(FRED_SERIES),
      history: observations.slice(0, parseInt(limit) || 12).map(o => ({ date: o.date, value: parseFloat(o.value) })),
      source: 'Federal Reserve Bank of St. Louis (FRED)',
      disclaimer: 'Information only. Data subject to revision.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

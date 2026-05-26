const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const SERIES = {
  unemployment_rate: 'LNS14000000',     // National unemployment rate
  nonfarm_payrolls: 'CES0000000001',    // Total nonfarm payrolls
  labor_force_participation: 'LNS11300000', // Labor force participation rate
  job_openings: 'JTS000000000000000JOL', // Total job openings (JOLTS)
  quits_rate: 'JTS000000000000000QUR',  // Quits rate
  avg_hourly_earnings: 'CES0500000003', // Avg hourly earnings, private sector
};

router.get('/', async (req, res) => {
  try {
    const { series = 'unemployment_rate', months = 13 } = req.query;
    const seriesId = SERIES[series] || SERIES.unemployment_rate;
    const cacheKey = `jobs:${seriesId}:${months}`;
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

    const latest = parseFloat(recent[0]?.value);
    const prevMonth = parseFloat(recent[1]?.value);
    const yearAgo = parseFloat(recent[12]?.value);

    const descriptions = {
      unemployment_rate: 'National Unemployment Rate (%)',
      nonfarm_payrolls: 'Total Nonfarm Payrolls (thousands)',
      labor_force_participation: 'Labor Force Participation Rate (%)',
      job_openings: 'Total Job Openings (thousands)',
      quits_rate: 'Quits Rate (%)',
      avg_hourly_earnings: 'Average Hourly Earnings, Private Sector ($)'
    };

    const result = {
      success: true,
      series,
      series_description: descriptions[series] || series,
      latest_value: latest,
      latest_period: `${recent[0]?.periodName} ${recent[0]?.year}`,
      mom_change: prevMonth ? Math.round((latest - prevMonth) * 100) / 100 : null,
      yoy_change: yearAgo ? Math.round((latest - yearAgo) * 100) / 100 : null,
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

const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const BASE_URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2';

router.get('/', async (req, res) => {
  try {
    const { series = 'debt', limit = 10 } = req.query;
    const cacheKey = `treasury:${series}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let result;

    if (series === 'debt') {
      const { data } = await axios.get(`${BASE_URL}/accounting/od/debt_to_penny`, {
        params: { limit: Math.min(parseInt(limit)||10, 30), sort: '-record_date', fields: 'record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt' },
        timeout: 10000
      });
      const records = data.data || [];
      const latest = records[0];
      const prev = records[1];
      const debt = parseFloat(latest?.tot_pub_debt_out_amt);
      const prevDebt = parseFloat(prev?.tot_pub_debt_out_amt);

      result = {
        success: true,
        series: 'debt',
        description: 'U.S. National Debt (Debt to the Penny)',
        latest_date: latest?.record_date,
        total_debt_usd: debt,
        total_debt_trillions: Math.round(debt / 1e12 * 100) / 100,
        debt_held_by_public: parseFloat(latest?.debt_held_public_amt),
        intragovernmental_holdings: parseFloat(latest?.intragov_hold_amt),
        daily_change_usd: prev ? Math.round(debt - prevDebt) : null,
        history: records.map(r => ({ date: r.record_date, total_trillions: Math.round(parseFloat(r.tot_pub_debt_out_amt)/1e12*100)/100 })),
        source: 'U.S. Treasury Fiscal Data',
        disclaimer: 'Information only.'
      };
    } else if (series === 'interest_rates') {
      const { data } = await axios.get(`${BASE_URL}/accounting/od/avg_interest_rates`, {
        params: { limit: Math.min(parseInt(limit)||10, 30), sort: '-record_date', fields: 'record_date,security_type_desc,security_desc,avg_interest_rate_amt' },
        timeout: 10000
      });
      const records = data.data || [];
      // Group by date
      const byDate = {};
      records.forEach(r => {
        if (!byDate[r.record_date]) byDate[r.record_date] = [];
        byDate[r.record_date].push({ security: r.security_desc || r.security_type_desc, avg_rate: parseFloat(r.avg_interest_rate_amt) });
      });
      const dates = Object.keys(byDate).sort().reverse();

      result = {
        success: true,
        series: 'interest_rates',
        description: 'Average Interest Rates on U.S. Treasury Securities',
        latest_date: dates[0],
        rates: byDate[dates[0]] || [],
        history_dates: dates.slice(0, parseInt(limit)||5),
        source: 'U.S. Treasury Fiscal Data',
        disclaimer: 'Information only.'
      };
    } else {
      return res.status(400).json({ error: 'Unknown series. Available: debt, interest_rates' });
    }

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

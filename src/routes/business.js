const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 86400 }); // 24hr - CBP updated annually

// State FIPS codes
const STATE_FIPS = {
  'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
  'FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20',
  'KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28',
  'MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36',
  'NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45',
  'SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
  'WI':'55','WY':'56','DC':'11'
};

// Common NAICS codes
const NAICS_LABELS = {
  '11':'Agriculture','21':'Mining','22':'Utilities','23':'Construction',
  '31':'Manufacturing','32':'Manufacturing','33':'Manufacturing',
  '42':'Wholesale Trade','44':'Retail Trade','45':'Retail Trade',
  '48':'Transportation','49':'Transportation','51':'Information/Technology',
  '52':'Finance & Insurance','53':'Real Estate','54':'Professional Services',
  '55':'Management','56':'Administrative Services','61':'Education',
  '62':'Healthcare','71':'Arts & Entertainment','72':'Accommodation & Food',
  '81':'Other Services'
};

router.get('/', async (req, res) => {
  try {
    const CENSUS_KEY = process.env.CENSUS_API_KEY;
    if (!CENSUS_KEY) return res.status(503).json({ error: 'Census API key not configured' });

    const { state, naics = '51', year = '2021' } = req.query;
    const fips = state ? (STATE_FIPS[state.toUpperCase()] || state) : '*';
    const cacheKey = `business:${fips}:${naics}:${year}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { data } = await axios.get(`https://api.census.gov/data/${year}/cbp`, {
      params: {
        get: 'NAICS2017,NAICS2017_LABEL,ESTAB,EMP,PAYANN',
        for: fips === '*' ? 'state:*' : `state:${fips}`,
        key: CENSUS_KEY,
        NAICS2017: naics
      },
      timeout: 15000
    });

    const [headers, ...rows] = data;
    const results = rows.map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return {
        state_fips: obj.state,
        naics: obj.NAICS2017,
        industry: obj.NAICS2017_LABEL || NAICS_LABELS[naics] || naics,
        establishments: parseInt(obj.ESTAB) || 0,
        employees: parseInt(obj.EMP) || 0,
        annual_payroll_thousands: parseInt(obj.PAYANN) || 0,
        avg_salary: obj.EMP > 0 ? Math.round((parseInt(obj.PAYANN) * 1000) / parseInt(obj.EMP)) : null
      };
    }).filter(r => r.establishments > 0)
      .sort((a, b) => b.employees - a.employees);

    // Add state names lookup
    const fipsToState = Object.entries(STATE_FIPS).reduce((acc, [k,v]) => { acc[v] = k; return acc; }, {});
    results.forEach(r => { r.state = fipsToState[r.state_fips] || r.state_fips; });

    const totalEstab = results.reduce((s, r) => s + r.establishments, 0);
    const totalEmp = results.reduce((s, r) => s + r.employees, 0);

    const result = {
      success: true,
      year,
      naics_code: naics,
      industry: results[0]?.industry || NAICS_LABELS[naics] || naics,
      state_filter: state || 'All States',
      count: results.length,
      totals: { establishments: totalEstab, employees: totalEmp },
      top_states: results.slice(0, 10),
      all_states: state ? results : undefined,
      available_naics: {
        '51': 'Information/Technology', '52': 'Finance & Insurance',
        '53': 'Real Estate', '54': 'Professional Services',
        '62': 'Healthcare', '72': 'Accommodation & Food',
        '23': 'Construction', '44': 'Retail Trade', '31': 'Manufacturing'
      },
      source: 'U.S. Census Bureau — County Business Patterns (CBP)',
      note: `Data from ${year} CBP survey. Most recent available.`,
      disclaimer: 'Information only.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[business] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

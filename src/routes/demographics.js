const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 86400 }); // 24hr - Census updated annually

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

// ACS 5-year variables (American Community Survey)
const ACS_VARS = {
  population: 'B01001_001E',
  median_age: 'B01002_001E',
  median_household_income: 'B19013_001E',
  per_capita_income: 'B19301_001E',
  poverty_rate_pct: 'B17001_002E', // below poverty level
  total_poverty_denom: 'B17001_001E',
  unemployment: 'B23025_005E', // unemployed
  labor_force: 'B23025_002E',
  median_home_value: 'B25077_001E',
  median_rent: 'B25064_001E',
  bachelors_or_higher: 'B15003_022E',
  total_25_plus: 'B15003_001E'
};

router.get('/', async (req, res) => {
  try {
    const CENSUS_KEY = process.env.CENSUS_API_KEY;
    if (!CENSUS_KEY) return res.status(503).json({ error: 'Census API key not configured', register: 'https://api.census.gov/data/key_signup.html' });

    const { state, level = 'state' } = req.query;
    const cacheKey = `census:${level}:${state||'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Build variables string
    const vars = Object.values(ACS_VARS).join(',');
    const params = {
      get: `NAME,${vars}`,
      key: CENSUS_KEY
    };

    let geoFilter;
    if (state) {
      const fips = STATE_FIPS[state.toUpperCase()] || state;
      if (level === 'county') {
        params['for'] = 'county:*';
        params['in'] = `state:${fips}`;
      } else {
        params['for'] = `state:${fips}`;
      }
    } else {
      params['for'] = 'state:*';
    }

    const { data: rawData } = await axios.get(
      'https://api.census.gov/data/2022/acs/acs5',
      { params, timeout: 15000 }
    );

    // Parse response (first row is headers)
    const [headers, ...rows] = rawData;
    const results = rows.map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);

      const pop = parseInt(obj[ACS_VARS.population]);
      const poverty = parseInt(obj[ACS_VARS.poverty_rate_pct]);
      const povertyDenom = parseInt(obj[ACS_VARS.total_poverty_denom]);
      const unemployed = parseInt(obj[ACS_VARS.unemployment]);
      const laborForce = parseInt(obj[ACS_VARS.labor_force]);
      const bachelors = parseInt(obj[ACS_VARS.bachelors_or_higher]);
      const over25 = parseInt(obj[ACS_VARS.total_25_plus]);

      return {
        name: obj.NAME,
        population: pop,
        median_age: parseFloat(obj[ACS_VARS.median_age]),
        median_household_income: parseInt(obj[ACS_VARS.median_household_income]),
        per_capita_income: parseInt(obj[ACS_VARS.per_capita_income]),
        poverty_rate_pct: povertyDenom > 0 ? Math.round((poverty/povertyDenom)*1000)/10 : null,
        unemployment_rate_pct: laborForce > 0 ? Math.round((unemployed/laborForce)*1000)/10 : null,
        median_home_value: parseInt(obj[ACS_VARS.median_home_value]),
        median_gross_rent: parseInt(obj[ACS_VARS.median_rent]),
        bachelors_degree_pct: over25 > 0 ? Math.round((bachelors/over25)*1000)/10 : null
      };
    }).filter(r => r.population > 0);

    const result = {
      success: true,
      level,
      year: '2022 (ACS 5-Year)',
      count: results.length,
      data: results,
      available_states: Object.keys(STATE_FIPS),
      source: 'U.S. Census Bureau — American Community Survey (ACS) 5-Year',
      disclaimer: 'Information only. Data from 2022 ACS 5-Year estimates.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[demographics] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

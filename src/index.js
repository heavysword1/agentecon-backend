require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const inflationRouter = require('./routes/inflation');
const jobsRouter = require('./routes/jobs');
const macroRouter = require('./routes/macro');
const energyRouter = require('./routes/energy');
const mcpRouter = require('./routes/mcp');
const treasuryRouter = require('./routes/treasury');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50kb' }));

const PAY_TO = process.env.X402_WALLET_ADDRESS || '0x24FAcafEB49b4e3FACF0B3e69604A2F4640c9bf2';
const X402_NETWORK = 'eip155:8453';
const PORT = process.env.PORT || 3008;

app.get('/', (req, res) => res.json({
  status: 'ok', service: 'AgentEcon', version: '1.0.0',
  description: 'Economic intelligence for AI agents — x402 on Base mainnet',
  endpoints: {
    inflation: 'GET /x402/econ/inflation — CPI inflation data, 6 series ($0.001)',
    jobs:      'GET /x402/econ/jobs      — Labor market: unemployment, payrolls, wages ($0.001)',
    macro:     'GET /x402/econ/macro     — GDP, Fed rates, Treasury yields, housing ($0.001)',
    energy:    'GET /x402/econ/energy    — WTI crude, Brent, natural gas, gasoline ($0.001)'
  },
  data_sources: ['BLS (no key)', 'FRED St. Louis Fed (free key)', 'EIA (free key)']
}));

app.get('/openapi.json', (req, res) => res.sendFile(require('path').join(__dirname, 'openapi.json')));
app.get('/favicon.ico', (req, res) => res.redirect('https://memoryapi.org/favicon.ico'));
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({ resource: 'https://econ.memoryapi.org/mcp', authorization_servers: [], bearer_methods_supported: [], resource_documentation: 'https://memoryapi.org' });
});
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.status(404).json({ error: 'No OAuth required.' });
});

try {
  const { createFacilitatorConfig } = require('@coinbase/x402');
  const rawConfig = createFacilitatorConfig(process.env.CDP_API_KEY_NAME, process.env.CDP_API_KEY_PRIVATE_KEY);
  const facilitatorClient = new HTTPFacilitatorClient({ url: rawConfig.url, createAuthHeaders: rawConfig.createAuthHeaders });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(paymentMiddleware(
    {
      'GET /x402/econ/inflation': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'U.S. CPI inflation data from BLS. Tracks all items, core, food, energy, shelter, and medical care indices.',
        extensions: { bazaar: { info: {
          description: 'U.S. Consumer Price Index (CPI) inflation data. Returns YoY and MoM changes with historical series.',
          input: { type: 'http', method: 'GET',
            queryParams: { series: 'all_items', months: '13' },
            schema: { properties: {
              series: { type: 'string', description: 'all_items, core, food, energy, shelter, medical' },
              months: { type: 'string', description: 'Number of months of history (default 13)' }
            }, required: [] }
          },
          output: { example: { success: true, series: 'all_items', latest_value: 333.02, latest_period: 'April 2026', yoy_change_pct: 2.4, mom_change_pct: 0.1 } }
        }}}
      },
      'GET /x402/econ/jobs': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'U.S. labor market data from BLS. Unemployment rate, nonfarm payrolls, job openings, quits rate, and wages.',
        extensions: { bazaar: { info: {
          description: 'U.S. labor market data from BLS. Covers unemployment, payrolls, job openings (JOLTS), and wage growth.',
          input: { type: 'http', method: 'GET',
            queryParams: { series: 'unemployment_rate', months: '13' },
            schema: { properties: {
              series: { type: 'string', description: 'unemployment_rate, nonfarm_payrolls, labor_force_participation, job_openings, quits_rate, avg_hourly_earnings' },
              months: { type: 'string', description: 'Months of history' }
            }, required: [] }
          },
          output: { example: { success: true, series: 'unemployment_rate', latest_value: 4.1, latest_period: 'April 2026', mom_change: -0.1, yoy_change: 0.3 } }
        }}}
      },
      'GET /x402/econ/macro': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Macroeconomic indicators from FRED (St. Louis Fed). GDP, Fed funds rate, Treasury yields, housing starts, retail sales.',
        extensions: { bazaar: { info: {
          description: 'Macroeconomic indicators from FRED. GDP, Fed funds rate, Treasury yields (2Y, 10Y, yield curve), housing, retail sales.',
          input: { type: 'http', method: 'GET',
            queryParams: { series: 'gdp', limit: '12' },
            schema: { properties: {
              series: { type: 'string', description: 'gdp, fed_funds_rate, treasury_10y, treasury_2y, yield_curve, housing_starts, retail_sales, consumer_sentiment, m2_money_supply, industrial_production' },
              limit: { type: 'string', description: 'Number of data points' }
            }, required: [] }
          },
          output: { example: { success: true, series: 'gdp', description: 'Gross Domestic Product (Billions USD)', latest_value: 29450.2, latest_date: '2026-01-01', change: 320.5 } }
        }}}
      },
      'GET /x402/econ/treasury': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'U.S. Treasury data — national debt (daily) and average interest rates on Treasury securities.',
        extensions: { bazaar: { info: {
          description: 'U.S. Treasury fiscal data. National debt to the penny (daily updates) and average interest rates on Treasury securities.',
          input: { type: 'http', method: 'GET',
            queryParams: { series: 'debt', limit: '10' },
            schema: { properties: {
              series: { type: 'string', description: 'debt (national debt to the penny) or interest_rates (avg Treasury rates)' },
              limit: { type: 'string', description: 'Number of records' }
            }, required: [] }
          },
          output: { example: { success: true, series: 'debt', latest_date: '2026-05-21', total_debt_trillions: 39.07, daily_change_usd: 21560524703 } }
        }}}
      },

      'GET /x402/econ/energy': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Energy price data from EIA. WTI crude oil, Brent crude, natural gas (Henry Hub), and U.S. retail gasoline prices.',
        extensions: { bazaar: { info: {
          description: 'Energy price data from EIA. WTI and Brent crude oil, natural gas, and retail gasoline prices with weekly history.',
          input: { type: 'http', method: 'GET',
            queryParams: { series: 'wti_crude', limit: '12' },
            schema: { properties: {
              series: { type: 'string', description: 'wti_crude, brent_crude, natural_gas, gasoline' },
              limit: { type: 'string', description: 'Number of weekly data points' }
            }, required: [] }
          },
          output: { example: { success: true, series: 'wti_crude', description: 'WTI Crude Oil Spot Price ($/barrel)', latest_value: 78.45, change: -1.20, change_pct: -1.51 } }
        }}}
      }
    },
    x402Server,
    { afterSettle: (req, res, next, s) => { const e = s?.extensionResponses; if (e) console.log('[CDP] EXTENSION-RESPONSES:', JSON.stringify(e)); next(); } },
    null, true
  ));

  console.log('CDP auth configured for x402 mainnet');
  console.log('x402 middleware initialized:', X402_NETWORK);
} catch (err) {
  console.error('x402 init failed:', err.message);
}

app.use('/x402/econ/inflation', inflationRouter);
app.use('/x402/econ/jobs', jobsRouter);
app.use('/x402/econ/macro', macroRouter);
app.use('/x402/econ/energy', energyRouter);
app.use('/x402/econ/treasury', treasuryRouter);
app.use('/mcp', mcpRouter);
app.use((req, res) => res.status(404).json({ error: 'Not found', service: 'AgentEcon' }));

app.listen(PORT, () => console.log(`AgentEcon running on port ${PORT}`));

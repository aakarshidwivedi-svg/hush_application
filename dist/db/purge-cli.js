import { loadConfig } from '../config/env.js';
import { purgeDeletedAccounts } from '../modules/account/service.js';
import { createPool } from './pool.js';
const config = loadConfig();
const pool = createPool(config.databaseUrl, 2);
try {
    console.log('purged', await purgeDeletedAccounts(pool));
}
finally {
    await pool.end();
}

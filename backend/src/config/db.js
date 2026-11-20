const { Pool, types } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

// Les colonnes DATE restent du texte 'YYYY-MM-DD' (pas de décalage de fuseau horaire)
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

pool.query('SELECT 1')
    .then(() => console.log('connected to the database'))
    .catch((err) => console.error('error connecting to the database', err));

module.exports = pool;

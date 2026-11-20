// Chargé avant chaque fichier de test : force l'utilisation d'une base de TEST séparée.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

process.env.DB_NAME = process.env.TEST_DB_NAME || 'fsts_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret_de_test';
process.env.NODE_ENV = 'test';
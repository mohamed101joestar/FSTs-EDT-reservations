require('./loadEnv');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

module.exports = async () => {
    const dbName = process.env.DB_NAME;
    // Sécurité : on ne touche jamais à une base qui n'est pas clairement une base de test
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) {
        throw new Error(`Nom de base de test invalide ("${dbName}") : il doit contenir "test".`);
    }

    const connexion = (database) => new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database,
    });

    const admin = connexion('postgres');
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();

    const db = connexion(dbName);
    await db.connect();
    const sql = fs.readFileSync(path.resolve(__dirname, '../../database/init.sql'), 'utf8');
    await db.query(sql);
    await db.end();
};

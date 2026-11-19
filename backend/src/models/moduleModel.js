const pool = require('../config/db');

const createModule = async (nom_module, code_module) => {
    const query = 'INSERT INTO module (nom_module, code_module) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(query, [nom_module, code_module]);
    return result.rows[0];
};

const getAllModules = async () => {
    const result = await pool.query('SELECT * FROM module ORDER BY id ASC');
    return result.rows;
};

const deleteModule = async (id) => {
    const result = await pool.query('DELETE FROM module WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createModule, getAllModules, deleteModule };
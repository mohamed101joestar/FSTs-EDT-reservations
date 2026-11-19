const pool = require('../config/db');

const createNiveau = async (libelle, code_niveau) => {
    const query = 'INSERT INTO niveau (libelle, code_niveau) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(query, [libelle, code_niveau]);
    return result.rows[0];
};

const getAllNiveaux = async () => {
    const result = await pool.query('SELECT * FROM niveau ORDER BY id ASC');
    return result.rows;
};

const deleteNiveau = async (id) => {
    const result = await pool.query('DELETE FROM niveau WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createNiveau, getAllNiveaux, deleteNiveau };
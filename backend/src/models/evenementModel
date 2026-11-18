const pool = require('../config/db');

const createEvenement = async (libelle) => {
    const query = 'INSERT INTO evenement (libelle) VALUES ($1) RETURNING *';
    const result = await pool.query(query, [libelle]);
    return result.rows[0];
};

const getAllEvenements = async () => {
    const result = await pool.query('SELECT * FROM evenement ORDER BY id ASC');
    return result.rows;
};

const deleteEvenement = async (id) => {
    const result = await pool.query('DELETE FROM evenement WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createEvenement, getAllEvenements, deleteEvenement };
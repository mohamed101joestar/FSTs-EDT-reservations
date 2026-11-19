const pool = require('../config/db');

const createFiliere = async (nom_filiere, code_filiere, niveau_id) => {
    const query = `
        INSERT INTO filiere (nom_filiere, code_filiere, niveau_id) 
        VALUES ($1, $2, $3) RETURNING *
    `;
    const result = await pool.query(query, [nom_filiere, code_filiere, niveau_id]);
    return result.rows[0];
};

const getAllFilieres = async () => {
    const query = `
        SELECT f.*, n.libelle as niveau_libelle 
        FROM filiere f
        JOIN niveau n ON f.niveau_id = n.id
        ORDER BY f.id ASC
    `;
    const result = await pool.query(query);
    return result.rows;
};

const deleteFiliere = async (id) => {
    const result = await pool.query('DELETE FROM filiere WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createFiliere, getAllFilieres, deleteFiliere };
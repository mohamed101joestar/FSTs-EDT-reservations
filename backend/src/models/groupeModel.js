const pool = require('../config/db');

const createGroupe = async (nom_groupe, effectif, filiere_id) => {
    const query = `
        INSERT INTO groupe (nom_groupe, effectif, filiere_id) 
        VALUES ($1, $2, $3) RETURNING *
    `;
    const result = await pool.query(query, [nom_groupe, effectif, filiere_id]);
    return result.rows[0];
};

const getAllGroupes = async () => {
    const query = `
        SELECT g.*, f.nom_filiere 
        FROM groupe g
        JOIN filiere f ON g.filiere_id = f.id
        ORDER BY g.id ASC
    `;
    const result = await pool.query(query);
    return result.rows;
};

const deleteGroupe = async (id) => {
    const result = await pool.query('DELETE FROM groupe WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createGroupe, getAllGroupes, deleteGroupe };
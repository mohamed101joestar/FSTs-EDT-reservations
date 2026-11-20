const pool = require('../config/db');

const createEdt = async (titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id) => {
    const query = `
        INSERT INTO edt (titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `;
    const values = [titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id];
    const result = await pool.query(query, values);
    return result.rows[0];
};

const getAllEdts = async () => {
    const query = `
        SELECT e.*, f.nom_filiere 
        FROM edt e
        JOIN filiere f ON e.filiere_id = f.id
        ORDER BY e.id ASC
    `;
    const result = await pool.query(query);
    return result.rows;
};

const getEdtById = async (id) => {
    const result = await pool.query('SELECT * FROM edt WHERE id = $1', [id]);
    return result.rows[0];
};

const deleteEdt = async (id) => {
    const result = await pool.query('DELETE FROM edt WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createEdt, getAllEdts, getEdtById, deleteEdt };
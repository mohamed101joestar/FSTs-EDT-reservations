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

// Ce que la suppression d'un EDT va emporter : ses séances et les enseignants concernés
const getResumeEdt = async (id) => {
    const seances = await pool.query('SELECT id FROM seance WHERE edt_id = $1 ORDER BY id', [id]);
    const enseignants = await pool.query(
        'SELECT enseignant_id, COUNT(*)::int AS nb FROM seance WHERE edt_id = $1 GROUP BY enseignant_id', [id]);
    return { seances: seances.rows.map((r) => r.id), enseignants: enseignants.rows };
};

const deleteEdt = async (id) => {
    const result = await pool.query('DELETE FROM edt WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = {
    getResumeEdt, createEdt, getAllEdts, getEdtById, deleteEdt };
const pool = require('../config/db');

const createCreneau = async (date_creneau, jour, heure_debut, heure_fin) => {
    const query = `
        INSERT INTO creneau (date_creneau, jour, heure_debut, heure_fin)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `;
    // date_creneau peut être null (pour un créneau hebdomadaire récurrent)
    const values = [date_creneau || null, jour, heure_debut, heure_fin];
    const result = await pool.query(query, values);
    return result.rows[0];
};

const getAllCreneaux = async () => {
    const result = await pool.query('SELECT * FROM creneau ORDER BY jour, heure_debut ASC');
    return result.rows;
};

const deleteCreneau = async (id) => {
    const result = await pool.query('DELETE FROM creneau WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createCreneau, getAllCreneaux, deleteCreneau };
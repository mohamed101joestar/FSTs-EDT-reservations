const pool = require('../config/db');

const createSalle = async (nom_salle, capacite, type_salle, etat) => {
    const query = `
        INSERT INTO salle (nom_salle, capacite, type_salle, etat)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `;
    const values = [nom_salle, capacite, type_salle, etat || 'disponible'];
    const result = await pool.query(query, values);
    return result.rows[0];
};

const getAllSalles = async () => {
    // On garde le LEFT JOIN pour afficher les équipements dans la liste globale
    const query = `
        SELECT s.*, COALESCE(json_agg(e.nom_equipement) FILTER (WHERE e.id IS NOT NULL), '[]') as equipements
        FROM salle s
        LEFT JOIN equipement e ON s.id = e.salle_id
        GROUP BY s.id
        ORDER BY s.id ASC
    `;
    const result = await pool.query(query);
    return result.rows;
};

const getSalleById = async (id) => {
    const query = `
        SELECT s.*, COALESCE(json_agg(e.nom_equipement) FILTER (WHERE e.id IS NOT NULL), '[]') as equipements
        FROM salle s
        LEFT JOIN equipement e ON s.id = e.salle_id
        WHERE s.id = $1
        GROUP BY s.id
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
};

const updateSalle = async (id, nom_salle, capacite, type_salle, etat) => {
    const query = `
        UPDATE salle 
        SET nom_salle = $1, capacite = $2, type_salle = $3, etat = $4
        WHERE id = $5
        RETURNING *
    `;
    const values = [nom_salle, capacite, type_salle, etat, id];
    const result = await pool.query(query, values);
    return result.rows[0];
};

const deleteSalle = async (id) => {
    const result = await pool.query('DELETE FROM salle WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = {
    createSalle,
    getAllSalles,
    getSalleById,
    updateSalle,
    deleteSalle
};
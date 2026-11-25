const pool = require('../config/db');

const createEquipement = async (salle_id, nom_equipement) => {
    const query = `
        INSERT INTO equipement (nom_equipement, salle_id)
        VALUES ($1, $2)
        RETURNING *
    `;
    const result = await pool.query(query, [nom_equipement, salle_id]);
    return result.rows[0];
};

const getEquipementsBySalle = async (salle_id) => {
    const query = 'SELECT * FROM equipement WHERE salle_id = $1 ORDER BY id ASC';
    const result = await pool.query(query, [salle_id]);
    return result.rows;
};

const getEquipementById = async (id) => {
    const result = await pool.query('SELECT * FROM equipement WHERE id = $1', [id]);
    return result.rows[0];
};

const updateEquipement = async (id, nom_equipement) => {
    const query = `
        UPDATE equipement 
        SET nom_equipement = $1
        WHERE id = $2
        RETURNING *
    `;
    const result = await pool.query(query, [nom_equipement, id]);
    return result.rows[0];
};

const deleteEquipement = async (id) => {
    const result = await pool.query('DELETE FROM equipement WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = {
    getEquipementById,
    createEquipement,
    getEquipementsBySalle,
    updateEquipement,
    deleteEquipement
};
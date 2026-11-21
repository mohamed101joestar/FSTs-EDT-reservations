const pool = require('../config/db');

const createReservation = async (enseignant_id, salle_id, creneau_id, groupe_id, evenement_id) => {
    const query = `
        INSERT INTO reservation (enseignant_id, salle_id, creneau_id, groupe_id, evenement_id, statut)
        VALUES ($1, $2, $3, $4, $5, 'en_attente') RETURNING *
    `;
    const res = await pool.query(query, [enseignant_id, salle_id, creneau_id, groupe_id, evenement_id]);
    return res.rows[0];
};

const getAllReservations = async (enseignant_id = null) => {
    const query = `
        SELECT r.*, 
               u.nom as enseignant_nom, u.prenom as enseignant_prenom,
               s.nom_salle, c.jour, c.heure_debut, c.heure_fin, c.date_creneau,
               g.nom_groupe, e.libelle as evenement
        FROM reservation r
        JOIN utilisateur u ON r.enseignant_id = u.id
        JOIN salle s ON r.salle_id = s.id
        JOIN creneau c ON r.creneau_id = c.id
        LEFT JOIN groupe g ON r.groupe_id = g.id
        JOIN evenement e ON r.evenement_id = e.id
        WHERE ($1::int IS NULL OR r.enseignant_id = $1)
        ORDER BY r.date_demande DESC
    `;
    const res = await pool.query(query, [enseignant_id]);
    return res.rows;
};

const getReservationById = async (id) => {
    const res = await pool.query('SELECT * FROM reservation WHERE id = $1', [id]);
    return res.rows[0];
};

const updateStatutReservation = async (id, statut, motif_rejet, admin_id) => {
    const query = `
        UPDATE reservation 
        SET statut = $1, motif_rejet = $2, admin_id = $3, date_traitement = NOW()
        WHERE id = $4 RETURNING *
    `;
    const res = await pool.query(query, [statut, motif_rejet, admin_id, id]);
    return res.rows[0];
};

const annulerReservation = async (id) => {
    const query = `
        UPDATE reservation 
        SET statut = 'annulee', date_traitement = NOW()
        WHERE id = $1 RETURNING *
    `;
    const res = await pool.query(query, [id]);
    return res.rows[0];
};

module.exports = { 
    createReservation, 
    getAllReservations, 
    getReservationById, 
    updateStatutReservation,
    annulerReservation
};
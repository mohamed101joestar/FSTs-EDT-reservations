const pool = require('../config/db');

// filtres facultatifs : entite, id_entite, utilisateur_id, action, depuis (date), jusqua (date)
const getHistorique = async ({ entite = null, id_entite = null, utilisateur_id = null, action = null, depuis = null, jusqua = null, limit = 50, offset = 0 } = {}) => {
    const where = `
        WHERE ($1::text IS NULL OR h.entite_concernee = $1)
          AND ($2::int  IS NULL OR h.id_entite = $2)
          AND ($3::int  IS NULL OR h.utilisateur_id = $3)
          AND ($4::text IS NULL OR h.action = $4)
          AND ($5::date IS NULL OR h.date_action::date >= $5::date)
          AND ($6::date IS NULL OR h.date_action::date <= $6::date)
    `;
    const filtres = [entite, id_entite, utilisateur_id, action, depuis, jusqua];
    const total = await pool.query(`SELECT COUNT(*) FROM historique h ${where}`, filtres);
    const lignes = await pool.query(`
        SELECT h.id, h.action, h.entite_concernee, h.id_entite, h.ancienne_valeur, h.nouvelle_valeur,
               h.date_action, h.utilisateur_id, u.nom AS utilisateur_nom, u.prenom AS utilisateur_prenom
        FROM historique h
        JOIN utilisateur u ON u.id = h.utilisateur_id
        ${where}
        ORDER BY h.date_action DESC, h.id DESC
        LIMIT $7 OFFSET $8
    `, [...filtres, limit, offset]);
    return { total: Number(total.rows[0].count), resultats: lignes.rows };
};

module.exports = { getHistorique };
const pool = require('../config/db');

// Notifications d'UNE personne, les plus récentes d'abord
const getNotifications = async (utilisateur_id, { nonLuesSeulement = false, limit = 50, offset = 0 } = {}) => {
    const res = await pool.query(`
        SELECT id, message, date_creation, est_lu
        FROM notification
        WHERE utilisateur_id = $1 AND ($2::boolean = FALSE OR est_lu = FALSE)
        ORDER BY date_creation DESC, id DESC
        LIMIT $3 OFFSET $4
    `, [utilisateur_id, nonLuesSeulement, limit, offset]);
    return res.rows;
};

const compterNonLues = async (utilisateur_id) => {
    const res = await pool.query('SELECT COUNT(*) FROM notification WHERE utilisateur_id = $1 AND est_lu = FALSE', [utilisateur_id]);
    return Number(res.rows[0].count);
};

// Ne marque que les notifications de cette personne (null si elle n'existe pas ou appartient à quelqu'un d'autre)
const marquerLue = async (id, utilisateur_id) => {
    const res = await pool.query(`
        UPDATE notification SET est_lu = TRUE WHERE id = $1 AND utilisateur_id = $2
        RETURNING id, message, date_creation, est_lu
    `, [id, utilisateur_id]);
    return res.rows[0] || null;
};

const marquerToutesLues = async (utilisateur_id) => {
    const res = await pool.query('UPDATE notification SET est_lu = TRUE WHERE utilisateur_id = $1 AND est_lu = FALSE', [utilisateur_id]);
    return res.rowCount;
};

module.exports = { getNotifications, compterNonLues, marquerLue, marquerToutesLues };
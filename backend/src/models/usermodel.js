const pool = require('../config/db');

// Colonnes publiques : le hash du mot de passe n'est JAMAIS renvoyé
const COLONNES = 'id, nom, prenom, email, role, actif';

const createUser = async (nom, prenom, email, motDePasseHash, role, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLONNES}`,
        [nom, prenom, email, motDePasseHash, role]);
    return result.rows[0];
};

// Pour la connexion : contient le hash du mot de passe
const getUserByEmail = async (email, executor = pool) => {
    const result = await executor.query('SELECT * FROM utilisateur WHERE email = $1', [email]);
    return result.rows[0];
};

// forUpdate : verrouille la ligne jusqu'à la fin de la transaction (modifications concurrentes)
const getUserById = async (id, executor = pool, forUpdate = false) => {
    const result = await executor.query(`SELECT ${COLONNES} FROM utilisateur WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    return result.rows[0];
};

// Utilisé à CHAQUE requête authentifiée : le rôle et l'état viennent de la base, pas du token
const getAuthById = async (id) => {
    const result = await pool.query('SELECT id, role, actif FROM utilisateur WHERE id = $1', [id]);
    return result.rows[0];
};

const emailPris = async (email, exclureId, executor = pool) => {
    const result = await executor.query('SELECT 1 FROM utilisateur WHERE email = $1 AND id <> $2', [email, exclureId]);
    return result.rows.length > 0;
};

// Les opérations qui peuvent retirer un administrateur (désactivation, changement de rôle) passent UNE PAR UNE :
// ainsi deux admins qui se désactivent mutuellement en même temps ne peuvent pas tous les deux réussir
// (verrou de transaction, libéré automatiquement à la fin ; à appeler au début de la transaction).
const serialiserGestionAdmins = async (executor) => {
    await executor.query('SELECT pg_advisory_xact_lock(424243)');
};

const adminsActifs = async (executor) => {
    const result = await executor.query("SELECT id FROM utilisateur WHERE role = 'admin' AND actif = TRUE ORDER BY id");
    return result.rows.map((r) => r.id);
};

const updateUser = async (id, champs, executor = pool) => {
    const cles = ['nom', 'prenom', 'email', 'role'].filter((k) => champs[k] !== undefined);
    const sets = cles.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const result = await executor.query(
        `UPDATE utilisateur SET ${sets} WHERE id = $${cles.length + 1} RETURNING ${COLONNES}`,
        [...cles.map((k) => champs[k]), id]);
    return result.rows[0];
};

const setActif = async (id, actif, executor = pool) => {
    const result = await executor.query(`UPDATE utilisateur SET actif = $1 WHERE id = $2 RETURNING ${COLONNES}`, [actif, id]);
    return result.rows[0];
};

const setPassword = async (id, hash, executor = pool) => {
    const result = await executor.query('UPDATE utilisateur SET mot_de_passe = $1 WHERE id = $2', [hash, id]);
    return result.rowCount > 0;
};

// Liste filtrée : role, actif (boolean), recherche (nom, prénom ou email)
const listUsers = async ({ role = null, actif = null, recherche = null, limit = 50, offset = 0 } = {}) => {
    const motif = recherche === null ? null : `%${recherche.replace(/[\\%_]/g, '\\$&')}%`;
    const where = `
        WHERE ($1::text IS NULL OR role = $1)
          AND ($2::boolean IS NULL OR actif = $2)
          AND ($3::text IS NULL OR nom ILIKE $3 OR prenom ILIKE $3 OR email ILIKE $3)
    `;
    const filtres = [role, actif, motif];
    const total = await pool.query(`SELECT COUNT(*) FROM utilisateur ${where}`, filtres);
    const lignes = await pool.query(
        `SELECT ${COLONNES} FROM utilisateur ${where} ORDER BY nom, prenom, id LIMIT $4 OFFSET $5`, [...filtres, limit, offset]);
    return { total: Number(total.rows[0].count), resultats: lignes.rows };
};

// Ce qui reste "en cours" pour un utilisateur (utile avant de désactiver son compte)
const getImpact = async (id, aujourdHui, executor = pool) => {
    const seances = await executor.query(`
        SELECT COUNT(*) FROM seance s JOIN edt e ON e.id = s.edt_id JOIN creneau c ON c.id = s.creneau_id
        WHERE s.enseignant_id = $1 AND (CASE WHEN c.date_creneau IS NOT NULL THEN c.date_creneau >= $2::date ELSE e.date_fin >= $2::date END)
    `, [id, aujourdHui]);
    const reservations = await executor.query(`
        SELECT COUNT(*) FROM reservation r JOIN creneau c ON c.id = r.creneau_id
        WHERE r.enseignant_id = $1 AND r.statut IN ('en_attente', 'confirmee') AND c.date_creneau >= $2::date
    `, [id, aujourdHui]);
    const demandes = await executor.query(
        "SELECT COUNT(*) FROM demande_changement WHERE enseignant_id = $1 AND statut = 'en_attente'", [id]);
    return {
        seances_a_venir: Number(seances.rows[0].count),
        reservations_a_venir: Number(reservations.rows[0].count),
        demandes_en_attente: Number(demandes.rows[0].count),
    };
};

module.exports = {
    createUser, getUserByEmail, getUserById, getAuthById, emailPris, serialiserGestionAdmins, adminsActifs,
    updateUser, setActif, setPassword, listUsers, getImpact,
};




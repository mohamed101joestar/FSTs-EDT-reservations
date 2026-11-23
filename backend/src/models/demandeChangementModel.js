const pool = require('../config/db');

const createDemande = async (d) => {
    const res = await pool.query(`
        INSERT INTO demande_changement
            (type_demande, date_occurrence, motif, seance_id, enseignant_id, nouveau_creneau_id, nouvelle_salle_id, statut)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_attente') RETURNING *
    `, [d.type_demande, d.date_occurrence, d.motif, d.seance_id, d.enseignant_id, d.nouveau_creneau_id, d.nouvelle_salle_id]);
    return res.rows[0];
};

const getDemandeById = async (id) => {
    const res = await pool.query('SELECT * FROM demande_changement WHERE id = $1', [id]);
    return res.rows[0];
};

// Liste enrichie. enseignant_id et statut sont des filtres optionnels (null = pas de filtre).
const getAllDemandes = async ({ enseignant_id = null, statut = null } = {}) => {
    const res = await pool.query(`
        SELECT d.*,
               u.nom AS enseignant_nom, u.prenom AS enseignant_prenom,
               m.nom_module,
               sa.nom_salle AS salle_actuelle,
               c.date_creneau AS date_creneau_actuel, c.jour AS jour_actuel,
               c.heure_debut AS heure_debut_actuelle, c.heure_fin AS heure_fin_actuelle,
               nc.date_creneau AS nouveau_date_creneau, nc.jour AS nouveau_jour,
               nc.heure_debut AS nouveau_heure_debut, nc.heure_fin AS nouveau_heure_fin,
               ns.nom_salle AS nouvelle_salle,
               ARRAY(SELECT g.nom_groupe FROM seance_groupe sg JOIN groupe g ON g.id = sg.groupe_id
                     WHERE sg.seance_id = s.id ORDER BY g.nom_groupe) AS groupes
        FROM demande_changement d
        JOIN utilisateur u ON d.enseignant_id = u.id
        JOIN seance s ON d.seance_id = s.id
        JOIN module m ON s.module_id = m.id
        JOIN salle sa ON s.salle_id = sa.id
        JOIN creneau c ON s.creneau_id = c.id
        LEFT JOIN creneau nc ON d.nouveau_creneau_id = nc.id
        LEFT JOIN salle ns ON d.nouvelle_salle_id = ns.id
        WHERE ($1::int IS NULL OR d.enseignant_id = $1)
          AND ($2::text IS NULL OR d.statut = $2)
        ORDER BY d.date_demande DESC, d.id DESC
    `, [enseignant_id, statut]);
    return res.rows;
};

// La séance avec son créneau, la période de son EDT et ses groupes
const getSeanceDetails = async (seance_id) => {
    const res = await pool.query(`
        SELECT s.id, s.edt_id, s.enseignant_id, s.salle_id, s.creneau_id,
               c.date_creneau, c.jour, c.heure_debut, c.heure_fin,
               e.date_debut AS edt_debut, e.date_fin AS edt_fin,
               ARRAY(SELECT groupe_id FROM seance_groupe WHERE seance_id = s.id) AS groupe_ids
        FROM seance s
        JOIN creneau c ON s.creneau_id = c.id
        JOIN edt e ON s.edt_id = e.id
        WHERE s.id = $1
    `, [seance_id]);
    return res.rows[0];
};

// Une demande ponctuelle déjà en attente ou acceptée pour cette occurrence ?
const existeDemandePonctuelleActive = async (seance_id, date_occurrence, exclureDemandeId = null) => {
    const res = await pool.query(`
        SELECT 1 FROM demande_changement
        WHERE seance_id = $1 AND date_occurrence = $2
          AND type_demande IN ('annulation_ponctuelle', 'deplacement_ponctuel')
          AND statut IN ('en_attente', 'acceptee')
          AND ($3::int IS NULL OR id <> $3)
    `, [seance_id, date_occurrence, exclureDemandeId]);
    return res.rows.length > 0;
};

const existeDemandeDefinitiveEnAttente = async (seance_id, exclureDemandeId = null) => {
    const res = await pool.query(`
        SELECT 1 FROM demande_changement
        WHERE seance_id = $1 AND type_demande = 'deplacement_definitif' AND statut = 'en_attente'
          AND ($2::int IS NULL OR id <> $2)
    `, [seance_id, exclureDemandeId]);
    return res.rows.length > 0;
};

// Changements ponctuels acceptés pour une date à venir (rendent un déplacement définitif incohérent)
const aDesChangementsPonctuelsAVenir = async (seance_id, aujourdHui) => {
    const res = await pool.query(`
        SELECT 1 FROM demande_changement
        WHERE seance_id = $1 AND statut = 'acceptee'
          AND type_demande IN ('annulation_ponctuelle', 'deplacement_ponctuel')
          AND date_occurrence >= $2
    `, [seance_id, aujourdHui]);
    return res.rows.length > 0;
};

// Les UPDATE sont gardés par statut = 'en_attente' : null si la demande a déjà été traitée.
const refuserDemande = async (id, motif_refus, admin_id) => {
    const res = await pool.query(`
        UPDATE demande_changement
        SET statut = 'refusee', motif_refus = $1, admin_id = $2, date_traitement = NOW()
        WHERE id = $3 AND statut = 'en_attente' RETURNING *
    `, [motif_refus, admin_id, id]);
    return res.rows[0] || null;
};

// executor : pool par défaut, ou un client de transaction.
// modifs (facultatif) : { nouveau_creneau_id, nouvelle_salle_id } = l'admin réaffecte la demande en l'acceptant.
const accepterDemandePonctuelle = async (id, admin_id, modifs = null, executor = pool) => {
    const res = modifs
        ? await executor.query(`
            UPDATE demande_changement
            SET statut = 'acceptee', admin_id = $1, date_traitement = NOW(), nouveau_creneau_id = $3, nouvelle_salle_id = $4
            WHERE id = $2 AND statut = 'en_attente' RETURNING *
        `, [admin_id, id, modifs.nouveau_creneau_id, modifs.nouvelle_salle_id])
        : await executor.query(`
            UPDATE demande_changement
            SET statut = 'acceptee', admin_id = $1, date_traitement = NOW()
            WHERE id = $2 AND statut = 'en_attente' RETURNING *
        `, [admin_id, id]);
    return res.rows[0] || null;
};

// Déplacement définitif : la demande ET la séance changent. À appeler avec un client de transaction.
const accepterDemandeDefinitive = async (id, admin_id, seance_id, creneau_id, salle_id, modifs = null, executor = pool) => {
    const demande = await accepterDemandePonctuelle(id, admin_id, modifs, executor);
    if (!demande) return null;
    await executor.query('UPDATE seance SET creneau_id = $1, salle_id = $2 WHERE id = $3', [creneau_id, salle_id, seance_id]);
    return demande;
};

const getCreneau = async (id) => {
    const res = await pool.query('SELECT id, date_creneau, jour, heure_debut, heure_fin FROM creneau WHERE id = $1', [id]);
    return res.rows[0];
};

module.exports = {
    createDemande, getDemandeById, getAllDemandes, getSeanceDetails,
    existeDemandePonctuelleActive, existeDemandeDefinitiveEnAttente, aDesChangementsPonctuelsAVenir,
    refuserDemande, accepterDemandePonctuelle, accepterDemandeDefinitive, getCreneau,
};
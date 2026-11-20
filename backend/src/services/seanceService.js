const pool = require('../config/db');

// 1. Vérifier le rôle de l'enseignant
const verifierRoleEnseignant = async (enseignant_id) => {
    const res = await pool.query('SELECT role FROM utilisateur WHERE id = $1', [enseignant_id]);
    if (res.rows.length === 0 || res.rows[0].role !== 'enseignant') {
        return "L'utilisateur spécifié n'est pas un enseignant valide.";
    }
    return null;
};

// 2. Vérifier que le créneau est dans les dates de l'EDT
const verifierDatesEdt = async (edt_id, creneau_id) => {
    const resEdt = await pool.query('SELECT date_debut, date_fin FROM edt WHERE id = $1', [edt_id]);
    if (resEdt.rows.length === 0) return "EDT introuvable.";
    const { date_debut, date_fin } = resEdt.rows[0];

    const resCreneau = await pool.query('SELECT date_creneau FROM creneau WHERE id = $1', [creneau_id]);
    if (resCreneau.rows.length === 0) return "Créneau introuvable.";
    
    const dateCreneau = resCreneau.rows[0].date_creneau;
    if (dateCreneau) {
        const dDebut = new Date(date_debut);
        const dFin = new Date(date_fin);
        const dCreneau = new Date(dateCreneau);
        if (dCreneau < dDebut || dCreneau > dFin) {
            return "La date du créneau est en dehors de la période de l'EDT.";
        }
    }
    return null;
};

// 3. Vérifier la capacité de la salle
const verifierCapaciteSalle = async (salle_id, groupe_ids) => {
    const resSalle = await pool.query('SELECT capacite FROM salle WHERE id = $1', [salle_id]);
    if (resSalle.rows.length === 0) return "Salle introuvable.";
    const capaciteSalle = resSalle.rows[0].capacite;

    if (groupe_ids && groupe_ids.length > 0) {
        const resGroupes = await pool.query('SELECT SUM(effectif) as total FROM groupe WHERE id = ANY($1)', [groupe_ids]);
        const effectifTotal = parseInt(resGroupes.rows[0].total) || 0;
        if (effectifTotal > capaciteSalle) {
            return `Capacité insuffisante (${effectifTotal} étudiants pour ${capaciteSalle} places).`;
        }
    }
    return null;
};

// 4. Vérifier les conflits (Enseignant, Salle, Groupe)
const verifierConflits = async (enseignant_id, salle_id, creneau_id, groupe_ids, seance_id_a_exclure = null) => {
    const excludeId = seance_id_a_exclure ? seance_id_a_exclure : -1;

    // Conflit Enseignant
    const resEns = await pool.query('SELECT id FROM seance WHERE enseignant_id = $1 AND creneau_id = $2 AND id != $3', [enseignant_id, creneau_id, excludeId]);
    if (resEns.rows.length > 0) return "Cet enseignant a déjà une séance sur ce créneau.";

    // Conflit Salle
    const resSalleConf = await pool.query('SELECT id FROM seance WHERE salle_id = $1 AND creneau_id = $2 AND id != $3', [salle_id, creneau_id, excludeId]);
    if (resSalleConf.rows.length > 0) return "Cette salle est déjà occupée sur ce créneau.";

    // Conflit Groupe
    if (groupe_ids && groupe_ids.length > 0) {
        const queryGrp = `
            SELECT g.nom_groupe FROM seance s
            JOIN seance_groupe sg ON s.id = sg.seance_id
            JOIN groupe g ON sg.groupe_id = g.id
            WHERE sg.groupe_id = ANY($1) AND s.creneau_id = $2 AND s.id != $3
        `;
        const resGrp = await pool.query(queryGrp, [groupe_ids, creneau_id, excludeId]);
        if (resGrp.rows.length > 0) return `Le groupe ${resGrp.rows[0].nom_groupe} a déjà une séance sur ce créneau.`;
    }
    return null;
};

// 5. LE CHEF D'ORCHESTRE (La fonction finale appelée par le contrôleur)
const validerToutesLesRegles = async (data, seance_id_a_exclure = null) => {
    const { edt_id, enseignant_id, salle_id, creneau_id, groupe_ids } = data;

    let erreur = await verifierRoleEnseignant(enseignant_id);
    if (erreur) return { valide: false, status: 400, message: erreur };

    erreur = await verifierDatesEdt(edt_id, creneau_id);
    if (erreur) return { valide: false, status: 400, message: erreur };

    erreur = await verifierCapaciteSalle(salle_id, groupe_ids);
    if (erreur) return { valide: false, status: 400, message: erreur };

    erreur = await verifierConflits(enseignant_id, salle_id, creneau_id, groupe_ids, seance_id_a_exclure);
    if (erreur) return { valide: false, status: 409, message: erreur };

    return { valide: true };
};

module.exports = { validerToutesLesRegles };
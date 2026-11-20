const pool = require('../config/db');

const erreur = (status, message) => ({ status, message });

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const getJourFromDate = (dateStr) => JOURS[new Date(`${dateStr}T12:00:00`).getDay()];

const estIdValide = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

// Vérifie et convertit le body en nombres. Retourne null si invalide.
const normaliserSeance = (body) => {
    const { enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids } = body;
    const simples = [enseignant_id, module_id, salle_id, creneau_id, evenement_id];
    if (!simples.every(estIdValide)) return null;
    if (!Array.isArray(groupe_ids) || groupe_ids.length === 0 || !groupe_ids.every(estIdValide)) return null;

    return {
        enseignant_id: Number(enseignant_id),
        module_id: Number(module_id),
        salle_id: Number(salle_id),
        creneau_id: Number(creneau_id),
        evenement_id: Number(evenement_id),
        groupe_ids: [...new Set(groupe_ids.map(Number))] // sans doublons
    };
};

const checkTimeOverlap = (c1, c2) => {
    if (!c1.heure_debut || !c2.heure_debut) return true;
    return c1.heure_debut < c2.heure_fin && c1.heure_fin > c2.heure_debut;
};

const checkDateOverlap = (c1, c2, edt1, edt2) => {
    // Périodes d'EDT qui ne se chevauchent pas : pas de conflit
    if (edt1.date_fin < edt2.date_debut || edt1.date_debut > edt2.date_fin) return false;

    // Les deux datés
    if (c1.date_creneau && c2.date_creneau) return c1.date_creneau === c2.date_creneau;

    // 1 daté, 2 récurrent
    if (c1.date_creneau && !c2.date_creneau) {
        if (c1.date_creneau < edt2.date_debut || c1.date_creneau > edt2.date_fin) return false;
        return getJourFromDate(c1.date_creneau) === c2.jour;
    }

    // 1 récurrent, 2 daté
    if (!c1.date_creneau && c2.date_creneau) {
        if (c2.date_creneau < edt1.date_debut || c2.date_creneau > edt1.date_fin) return false;
        return getJourFromDate(c2.date_creneau) === c1.jour;
    }

    // Les deux récurrents
    return c1.jour === c2.jour;
};

// data doit venir de normaliserSeance + edt_id (nombres). Retourne null si tout est bon,
// sinon { status, message }.
const validerToutesLesRegles = async (data, seance_id_a_exclure = null) => {
    const { edt_id, enseignant_id, salle_id, creneau_id, groupe_ids } = data;

    // 1. Vérifications de base
    const resUser = await pool.query('SELECT role FROM utilisateur WHERE id = $1', [enseignant_id]);
    if (resUser.rows.length === 0 || resUser.rows[0].role !== 'enseignant') {
        return erreur(400, "L'utilisateur n'est pas un enseignant valide.");
    }

    const resEdt = await pool.query('SELECT date_debut, date_fin, filiere_id FROM edt WHERE id = $1', [edt_id]);
    if (resEdt.rows.length === 0) return erreur(404, "EDT introuvable.");
    const edtActuel = resEdt.rows[0];

    const resSalle = await pool.query('SELECT capacite, etat FROM salle WHERE id = $1', [salle_id]);
    if (resSalle.rows.length === 0) return erreur(400, "Salle introuvable.");
    const salle = resSalle.rows[0];
    if (salle.etat !== 'disponible') return erreur(409, `La salle est actuellement ${salle.etat}.`);

    const resCreneau = await pool.query(
        'SELECT date_creneau, jour, heure_debut, heure_fin FROM creneau WHERE id = $1', [creneau_id]
    );
    if (resCreneau.rows.length === 0) return erreur(400, "Créneau introuvable.");
    const nouveauCreneau = resCreneau.rows[0];

    if (nouveauCreneau.date_creneau &&
        (nouveauCreneau.date_creneau < edtActuel.date_debut || nouveauCreneau.date_creneau > edtActuel.date_fin)) {
        return erreur(400, "La date du créneau est en dehors de la période de l'EDT.");
    }

    // 2. Groupes (existence, filière, capacité)
    const resGroupes = await pool.query(
        'SELECT id, effectif, filiere_id FROM groupe WHERE id = ANY($1)', [groupe_ids]
    );
    if (resGroupes.rows.length !== groupe_ids.length) return erreur(400, "Un des groupes spécifiés n'existe pas.");

    let effectifTotal = 0;
    for (const groupe of resGroupes.rows) {
        if (groupe.filiere_id !== edtActuel.filiere_id) {
            return erreur(400, "Un des groupes n'appartient pas à la filière de l'EDT.");
        }
        effectifTotal += groupe.effectif;
    }
    if (effectifTotal > salle.capacite) {
        return erreur(400, `Capacité insuffisante (${effectifTotal} étudiants pour ${salle.capacite} places).`);
    }

    // 3. Conflits (salle, enseignant, groupes)
    const excludeId = seance_id_a_exclure ? Number(seance_id_a_exclure) : -1;
    const resExistantes = await pool.query(`
        SELECT s.id AS seance_id, s.salle_id, s.enseignant_id,
               c.date_creneau, c.jour, c.heure_debut, c.heure_fin,
               e.date_debut AS edt_debut, e.date_fin AS edt_fin
        FROM seance s
        JOIN creneau c ON s.creneau_id = c.id
        JOIN edt e ON s.edt_id = e.id
        WHERE s.id != $1
    `, [excludeId]);

    for (const seance of resExistantes.rows) {
        const edtExistant = { date_debut: seance.edt_debut, date_fin: seance.edt_fin };
        if (!checkDateOverlap(nouveauCreneau, seance, edtActuel, edtExistant)) continue;
        if (!checkTimeOverlap(nouveauCreneau, seance)) continue;

        if (seance.salle_id === salle_id) return erreur(409, "Cette salle est déjà occupée sur ce créneau (chevauchement horaire).");
        if (seance.enseignant_id === enseignant_id) return erreur(409, "Cet enseignant a déjà une séance sur ce créneau (chevauchement horaire).");

        const resGrp = await pool.query(
            'SELECT 1 FROM seance_groupe WHERE seance_id = $1 AND groupe_id = ANY($2)',
            [seance.seance_id, groupe_ids]
        );
        if (resGrp.rows.length > 0) return erreur(409, "Un des groupes a déjà une séance sur ce créneau (chevauchement horaire).");
    }

    return null;
};

module.exports = { normaliserSeance, validerToutesLesRegles };
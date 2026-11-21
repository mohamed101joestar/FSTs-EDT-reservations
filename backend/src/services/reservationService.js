const pool = require('../config/db');
const { aujourdHui } = require('../utils/timeUtils');
const { trouverConflit, messageConflit, PERIODE_LARGE } = require('./disponibiliteService');

const erreur = (status, message) => ({ status, message });

const verifierDisponibilite = async (enseignant_id, salle_id, creneau_id, groupe_id) => {
    // 1. Forcer la conversion en nombre
    enseignant_id = Number(enseignant_id);
    salle_id = Number(salle_id);
    creneau_id = Number(creneau_id);
    groupe_id = Number(groupe_id);

    const resCreneau = await pool.query('SELECT * FROM creneau WHERE id = $1', [creneau_id]);
    if (resCreneau.rows.length === 0) return erreur(400, "Créneau introuvable.");
    const nouveauCreneau = resCreneau.rows[0];

    if (!nouveauCreneau.date_creneau) {
        return erreur(400, "Une réservation doit obligatoirement être liée à un créneau daté (une date spécifique), pas à un créneau récurrent.");
    }

    // 2. Vérifier que la date n'est pas dans le passé
    if (nouveauCreneau.date_creneau < aujourdHui()) {
        return erreur(409, "Impossible de réserver une date passée.");
    }

    const resSalle = await pool.query('SELECT capacite, etat FROM salle WHERE id = $1', [salle_id]);
    if (resSalle.rows.length === 0) return erreur(400, "Salle introuvable.");
    const salle = resSalle.rows[0];
    if (salle.etat !== 'disponible') return erreur(409, `La salle est actuellement ${salle.etat}.`);

    // 3. Vérifier la capacité de la salle
    const resGroupe = await pool.query('SELECT effectif FROM groupe WHERE id = $1', [groupe_id]);
    if (resGroupe.rows.length === 0) return erreur(400, "Groupe introuvable.");
    const effectifGroupe = resGroupe.rows[0].effectif;
    if (effectifGroupe > salle.capacite) {
        return erreur(409, `Capacité insuffisante (le groupe compte ${effectifGroupe} étudiants pour ${salle.capacite} places).`);
    }

    // 4. Conflits avec les séances (EDT), les occurrences déplacées et les réservations confirmées
    const conflit = await trouverConflit({
        enseignant_id, salle_id, groupe_ids: [groupe_id],
        creneau: nouveauCreneau,
        periode: PERIODE_LARGE,
    });
    if (conflit) return erreur(409, messageConflit(conflit));

    return null;
};

module.exports = { verifierDisponibilite };
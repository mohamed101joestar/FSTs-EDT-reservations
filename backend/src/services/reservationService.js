const pool = require('../config/db');
const { checkTimeOverlap, checkDateOverlap } = require('../utils/timeUtils');

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
    // On utilise toLocaleDateString('fr-CA') qui donne le format YYYY-MM-DD en heure locale
    const aujourdHui = new Date().toLocaleDateString('fr-CA');
    if (nouveauCreneau.date_creneau < aujourdHui) {
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

    // 4. Vérifier les conflits avec les SÉANCES (EDT)
    const querySeances = `
        SELECT s.id, s.salle_id, s.enseignant_id, c.*, e.date_debut AS edt_debut, e.date_fin AS edt_fin,
               ARRAY(SELECT groupe_id FROM seance_groupe WHERE seance_id = s.id) as groupe_ids
        FROM seance s
        JOIN creneau c ON s.creneau_id = c.id
        JOIN edt e ON s.edt_id = e.id
        WHERE s.salle_id = $1 OR s.enseignant_id = $2 OR EXISTS (
            SELECT 1 FROM seance_groupe sg WHERE sg.seance_id = s.id AND sg.groupe_id = $3
        )
    `;
    const resSeances = await pool.query(querySeances, [salle_id, enseignant_id, groupe_id]);

    for (const seance of resSeances.rows) {
        const edtExistant = { date_debut: seance.edt_debut, date_fin: seance.edt_fin };
        const edtActuel = { date_debut: '2000-01-01', date_fin: '2100-12-31' }; 
        
        // On s'assure que les ids de seance sont des nombres pour la comparaison
        if (checkDateOverlap(nouveauCreneau, seance, edtActuel, edtExistant) && checkTimeOverlap(nouveauCreneau, seance)) {
            if (Number(seance.salle_id) === salle_id) return erreur(409, "La salle est déjà occupée par un cours (EDT) sur ce créneau.");
            if (Number(seance.enseignant_id) === enseignant_id) return erreur(409, "L'enseignant a déjà un cours (EDT) sur ce créneau.");
            if (seance.groupe_ids.map(Number).includes(groupe_id)) return erreur(409, "Le groupe a déjà un cours (EDT) sur ce créneau.");
        }
    }

    // 5. Vérifier les conflits avec les RÉSERVATIONS CONFIRMÉES
    const queryResas = `
        SELECT r.salle_id, r.enseignant_id, r.groupe_id, c.*
        FROM reservation r
        JOIN creneau c ON r.creneau_id = c.id
        WHERE r.statut = 'confirmee' AND (r.salle_id = $1 OR r.enseignant_id = $2 OR r.groupe_id = $3)
    `;
    const resResas = await pool.query(queryResas, [salle_id, enseignant_id, groupe_id]);

    for (const resa of resResas.rows) {
        const edtActuel = { date_debut: '2000-01-01', date_fin: '2100-12-31' };
        if (checkDateOverlap(nouveauCreneau, resa, edtActuel, edtActuel) && checkTimeOverlap(nouveauCreneau, resa)) {
            if (Number(resa.salle_id) === salle_id) return erreur(409, "La salle a déjà une réservation confirmée sur ce créneau.");
            if (Number(resa.enseignant_id) === enseignant_id) return erreur(409, "L'enseignant a déjà une réservation confirmée sur ce créneau.");
            if (Number(resa.groupe_id) === groupe_id) return erreur(409, "Le groupe a déjà une réservation confirmée sur ce créneau.");
        }
    }

    return null;
};

module.exports = { verifierDisponibilite };
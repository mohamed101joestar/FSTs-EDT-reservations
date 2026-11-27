const pool = require('../config/db');
const { trouverConflit, messageConflit } = require('./disponibiliteService');

const erreur = (status, message) => ({ status, message });

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

// data doit venir de normaliserSeance + edt_id (nombres). Retourne null si tout est bon,
// sinon { status, message }.
const validerToutesLesRegles = async (data, seance_id_a_exclure = null) => {
    const { edt_id, enseignant_id, salle_id, creneau_id, groupe_ids } = data;

    // 1. Vérifications de base
    const resUser = await pool.query('SELECT role, actif FROM utilisateur WHERE id = $1', [enseignant_id]);
    if (resUser.rows.length === 0 || resUser.rows[0].role !== 'enseignant') {
        return erreur(400, "L'utilisateur n'est pas un enseignant valide.");
    }
    if (!resUser.rows[0].actif) return erreur(400, "Cet enseignant est désactivé : confiez la séance à un autre enseignant.");

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

    // 3. Conflits (salle, enseignant, groupes) avec les séances, les occurrences déplacées
    //    et les réservations confirmées
    const conflit = await trouverConflit({
        enseignant_id, salle_id, groupe_ids,
        creneau: nouveauCreneau,
        periode: { date_debut: edtActuel.date_debut, date_fin: edtActuel.date_fin },
    }, { exclureSeanceId: seance_id_a_exclure });
    if (conflit) return erreur(409, messageConflit(conflit));

    return null;
};

module.exports = { normaliserSeance, validerToutesLesRegles };
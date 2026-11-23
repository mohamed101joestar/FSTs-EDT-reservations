const pool = require('../config/db');
const demandeModel = require('../models/demandeChangementModel');
const seanceService = require('./seanceService');
const { trouverConflit, messageConflit, PERIODE_LARGE } = require('./disponibiliteService');
const { getJourFromDate, aujourdHui, estDateValide } = require('../utils/timeUtils');

const erreur = (status, message) => ({ status, message });

const TYPES = ['annulation_ponctuelle', 'deplacement_ponctuel', 'deplacement_definitif'];
const estIdValide = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const estAbsent = (v) => v === undefined || v === null || v === '';

const getCreneau = async (id) =>
    (await pool.query('SELECT id, date_creneau, jour, heure_debut, heure_fin FROM creneau WHERE id = $1', [id])).rows[0];

const getSalle = async (id) =>
    (await pool.query('SELECT id, capacite, etat FROM salle WHERE id = $1', [id])).rows[0];

// Vrai si `date` est un jour où la séance a réellement lieu
const estOccurrenceDeLaSeance = (seance, date) => {
    if (seance.date_creneau) return date === seance.date_creneau;
    return getJourFromDate(date) === seance.jour && date >= seance.edt_debut && date <= seance.edt_fin;
};

/**
 * Contrôles de forme + règles propres à la CRÉATION d'une demande.
 * options.exclureDemandeId : ignorer cette demande dans les vérifications de doublons
 *                            (utilisé lors d'une réaffectation par l'admin).
 * Retourne { erreur } ou { demande, seance } (demande prête à être insérée).
 */
const preparerDemande = async (body, enseignant_id, options = {}) => {
    const exclureDemandeId = options.exclureDemandeId || null;
    const { type_demande } = body;

    if (!TYPES.includes(type_demande)) {
        return { erreur: erreur(400, "type_demande invalide (annulation_ponctuelle, deplacement_ponctuel ou deplacement_definitif).") };
    }
    if (!estIdValide(body.seance_id)) return { erreur: erreur(400, "seance_id invalide.") };

    if (!estAbsent(body.nouveau_creneau_id) && !estIdValide(body.nouveau_creneau_id)) {
        return { erreur: erreur(400, "nouveau_creneau_id invalide.") };
    }
    if (!estAbsent(body.nouvelle_salle_id) && !estIdValide(body.nouvelle_salle_id)) {
        return { erreur: erreur(400, "nouvelle_salle_id invalide.") };
    }

    let motif = null;
    if (!estAbsent(body.motif)) {
        if (typeof body.motif !== 'string') return { erreur: erreur(400, "Le motif doit être un texte.") };
        motif = body.motif.trim() || null;
        if (motif && motif.length > 255) return { erreur: erreur(400, "Le motif est trop long (255 caractères maximum).") };
    }

    const seance = await demandeModel.getSeanceDetails(Number(body.seance_id));
    if (!seance) return { erreur: erreur(404, "Séance introuvable.") };
    if (Number(seance.enseignant_id) !== Number(enseignant_id)) {
        return { erreur: erreur(403, "Vous ne pouvez demander un changement que pour vos propres séances.") };
    }

    const demande = {
        type_demande,
        date_occurrence: null,
        motif,
        seance_id: Number(body.seance_id),
        enseignant_id: Number(enseignant_id),
        nouveau_creneau_id: estAbsent(body.nouveau_creneau_id) ? null : Number(body.nouveau_creneau_id),
        nouvelle_salle_id: estAbsent(body.nouvelle_salle_id) ? null : Number(body.nouvelle_salle_id),
    };

    // ---- Changements ponctuels : quelle occurrence ? ----
    if (type_demande !== 'deplacement_definitif') {
        const date = body.date_occurrence;
        if (!estDateValide(date)) {
            return { erreur: erreur(400, "date_occurrence est obligatoire au format AAAA-MM-JJ pour un changement ponctuel.") };
        }
        if (date < aujourdHui()) return { erreur: erreur(400, "La date de l'occurrence ne peut pas être dans le passé.") };
        if (!estOccurrenceDeLaSeance(seance, date)) {
            const attendu = seance.date_creneau
                ? `le ${seance.date_creneau}`
                : `un ${seance.jour} entre le ${seance.edt_debut} et le ${seance.edt_fin}`;
            return { erreur: erreur(400, `Cette date n'est pas un jour de cours de la séance (attendu : ${attendu}).`) };
        }
        demande.date_occurrence = date;
        // CORRECTION : on exclut la demande en cours de modification
        if (await demandeModel.existeDemandePonctuelleActive(seance.id, date, exclureDemandeId)) {
            return { erreur: erreur(409, "Une demande est déjà en attente ou acceptée pour cette occurrence de la séance.") };
        }
    }

    if (type_demande === 'annulation_ponctuelle') {
        // une annulation ne déplace rien
        demande.nouveau_creneau_id = null;
        demande.nouvelle_salle_id = null;
        return { demande, seance };
    }

    // ---- Déplacements : il faut une nouvelle destination ----
    if (!demande.nouveau_creneau_id && !demande.nouvelle_salle_id) {
        return { erreur: erreur(400, "Un déplacement doit proposer un nouveau créneau et/ou une nouvelle salle.") };
    }

    let nouveauCreneau = null;
    if (demande.nouveau_creneau_id) {
        nouveauCreneau = await getCreneau(demande.nouveau_creneau_id);
        if (!nouveauCreneau) return { erreur: erreur(400, "Nouveau créneau introuvable.") };
    }
    if (demande.nouvelle_salle_id && !(await getSalle(demande.nouvelle_salle_id))) {
        return { erreur: erreur(400, "Nouvelle salle introuvable.") };
    }

    if (type_demande === 'deplacement_ponctuel') {
        if (nouveauCreneau) {
            if (!nouveauCreneau.date_creneau) {
                return { erreur: erreur(400, "Pour un déplacement ponctuel, le nouveau créneau doit être daté (une date précise).") };
            }
            if (nouveauCreneau.date_creneau < seance.edt_debut || nouveauCreneau.date_creneau > seance.edt_fin) {
                return { erreur: erreur(400, "La nouvelle date est en dehors de la période de l'EDT.") };
            }
            if (nouveauCreneau.date_creneau < aujourdHui()) {
                return { erreur: erreur(400, "La nouvelle date ne peut pas être dans le passé.") };
            }
        }
        const memeHoraire = !nouveauCreneau || (
            nouveauCreneau.date_creneau === demande.date_occurrence &&
            nouveauCreneau.heure_debut === seance.heure_debut && nouveauCreneau.heure_fin === seance.heure_fin);
        const memeSalle = !demande.nouvelle_salle_id || demande.nouvelle_salle_id === Number(seance.salle_id);
        if (memeHoraire && memeSalle) {
            return { erreur: erreur(400, "Le déplacement demandé est identique à la situation actuelle.") };
        }
    } else {
        // deplacement_definitif
        if (nouveauCreneau && Boolean(nouveauCreneau.date_creneau) !== Boolean(seance.date_creneau)) {
            return { erreur: erreur(400, "Le nouveau créneau doit être du même type que l'actuel (récurrent ou daté).") };
        }
        const memeCreneau = !demande.nouveau_creneau_id || demande.nouveau_creneau_id === Number(seance.creneau_id);
        const memeSalle = !demande.nouvelle_salle_id || demande.nouvelle_salle_id === Number(seance.salle_id);
        if (memeCreneau && memeSalle) {
            return { erreur: erreur(400, "Le déplacement demandé est identique à la situation actuelle.") };
        }
        // CORRECTION : on exclut la demande en cours de modification
        if (await demandeModel.existeDemandeDefinitiveEnAttente(seance.id, exclureDemandeId)) {
            return { erreur: erreur(409, "Une demande de déplacement définitif est déjà en attente pour cette séance.") };
        }
    }

    return { demande, seance };
};

/**
 * Règles qui dépendent de l'état ACTUEL du planning (conflits, salle, dates).
 * Utilisée à la création ET à l'acceptation (le planning a pu changer entre-temps).
 * Retourne null ou { status, message }.
 */
const verifierFaisabilite = async (demande, seance) => {
    const today = aujourdHui();
    const groupe_ids = (seance.groupe_ids || []).map(Number);

    if (demande.type_demande === 'annulation_ponctuelle') {
        if (demande.date_occurrence < today) return erreur(409, "La date de la séance à annuler est déjà passée.");
        return null;
    }

    if (demande.type_demande === 'deplacement_ponctuel') {
        if (demande.date_occurrence < today) return erreur(409, "La date de la séance à déplacer est déjà passée.");

        const nouveauCreneau = demande.nouveau_creneau_id ? await getCreneau(demande.nouveau_creneau_id) : null;
        if (demande.nouveau_creneau_id && !nouveauCreneau) return erreur(400, "Nouveau créneau introuvable.");

        const date = nouveauCreneau ? nouveauCreneau.date_creneau : demande.date_occurrence;
        if (date < today) return erreur(409, "La nouvelle date est déjà passée.");

        const salle_id = demande.nouvelle_salle_id ? Number(demande.nouvelle_salle_id) : Number(seance.salle_id);
        const salle = await getSalle(salle_id);
        if (!salle) return erreur(400, "Salle introuvable.");
        if (salle.etat !== 'disponible') return erreur(409, `La salle est actuellement ${salle.etat}.`);

        const resEffectif = await pool.query('SELECT COALESCE(SUM(effectif), 0) AS total FROM groupe WHERE id = ANY($1::int[])', [groupe_ids]);
        const effectif = Number(resEffectif.rows[0].total);
        if (effectif > salle.capacite) {
            return erreur(400, `Capacité insuffisante (${effectif} étudiants pour ${salle.capacite} places).`);
        }

        // L'occurrence d'origine est libérée par ce déplacement : on l'ignore pour ne pas
        // entrer en conflit avec soi-même.
        const conflit = await trouverConflit({
            enseignant_id: seance.enseignant_id, salle_id, groupe_ids,
            creneau: {
                date_creneau: date,
                jour: getJourFromDate(date),
                heure_debut: nouveauCreneau ? nouveauCreneau.heure_debut : seance.heure_debut,
                heure_fin: nouveauCreneau ? nouveauCreneau.heure_fin : seance.heure_fin,
            },
            periode: PERIODE_LARGE,
        }, { ignorerOccurrence: { seance_id: seance.id, date: demande.date_occurrence } });
        if (conflit) return erreur(409, messageConflit(conflit));
        return null;
    }

    // deplacement_definitif
    if (seance.edt_fin < today) return erreur(409, "L'emploi du temps de cette séance est terminé.");
    if (await demandeModel.aDesChangementsPonctuelsAVenir(seance.id, today)) {
        return erreur(409, "Des changements ponctuels déjà acceptés existent pour cette séance à partir d'aujourd'hui : un déplacement définitif les rendrait incohérents.");
    }
    // Mêmes règles que pour une séance (enseignant, salle, période, groupes, conflits, réservations),
    // en ignorant la séance elle-même.
    return seanceService.validerToutesLesRegles({
        edt_id: Number(seance.edt_id),
        enseignant_id: Number(seance.enseignant_id),
        salle_id: demande.nouvelle_salle_id ? Number(demande.nouvelle_salle_id) : Number(seance.salle_id),
        creneau_id: demande.nouveau_creneau_id ? Number(demande.nouveau_creneau_id) : Number(seance.creneau_id),
        groupe_ids,
    }, seance.id);
};

module.exports = { preparerDemande, verifierFaisabilite };
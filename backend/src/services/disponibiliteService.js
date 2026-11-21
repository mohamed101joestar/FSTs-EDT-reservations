const pool = require('../config/db');
const { checkTimeOverlap, checkDateOverlap, getJourFromDate } = require('../utils/timeUtils');

// Période "infinie" pour les occupations datées (réservations, occurrences déplacées)
const PERIODE_LARGE = { date_debut: '2000-01-01', date_fin: '2100-12-31' };

/**
 * Moteur UNIQUE de détection de conflits (séances, réservations, demandes de changement).
 *
 * candidat = {
 *   enseignant_id, salle_id, groupe_ids: [..],
 *   creneau: { date_creneau, jour, heure_debut, heure_fin },
 *   periode: { date_debut, date_fin }          // période de l'EDT, ou PERIODE_LARGE si créneau daté
 * }
 * options = {
 *   exclureSeanceId,                            // ignorer entièrement cette séance (ex. quand on la modifie)
 *   ignorerOccurrence: { seance_id, date }      // ignorer UNE occurrence d'une séance (ex. celle qu'on déplace)
 * }
 *
 * Occupations prises en compte :
 *   1. les séances de l'EDT, SAUF les occurrences annulées/déplacées par une demande acceptée
 *   2. les occurrences déplacées (déplacement ponctuel accepté) à leur nouvelle place
 *   3. les réservations confirmées
 *
 * Retourne null, ou { ressource: 'salle'|'enseignant'|'groupe', source: 'cours'|'deplacement'|'reservation' }
 */
const trouverConflit = async (candidat, options = {}) => {
    const salle_id = Number(candidat.salle_id);
    const enseignant_id = Number(candidat.enseignant_id);
    const groupe_ids = (candidat.groupe_ids || []).map(Number);
    const exclure = options.exclureSeanceId ? Number(options.exclureSeanceId) : null;

    const ressourceEnConflit = (occ) => {
        if (Number(occ.salle_id) === salle_id) return 'salle';
        if (Number(occ.enseignant_id) === enseignant_id) return 'enseignant';
        if ((occ.groupe_ids || []).some((g) => groupe_ids.includes(Number(g)))) return 'groupe';
        return null;
    };

    const seChevauchent = (occ) =>
        checkDateOverlap(candidat.creneau, occ.creneau, candidat.periode, occ.periode) &&
        checkTimeOverlap(candidat.creneau, occ.creneau);

    // ---- 1. Séances de l'EDT ----
    const resSeances = await pool.query(`
        SELECT s.id AS seance_id, s.salle_id, s.enseignant_id,
               c.date_creneau, c.jour, c.heure_debut, c.heure_fin,
               e.date_debut AS edt_debut, e.date_fin AS edt_fin,
               ARRAY(SELECT groupe_id FROM seance_groupe WHERE seance_id = s.id) AS groupe_ids
        FROM seance s
        JOIN creneau c ON s.creneau_id = c.id
        JOIN edt e ON s.edt_id = e.id
        WHERE ($4::int IS NULL OR s.id <> $4)
          AND (s.salle_id = $1 OR s.enseignant_id = $2 OR EXISTS (
                SELECT 1 FROM seance_groupe sg WHERE sg.seance_id = s.id AND sg.groupe_id = ANY($3::int[])))
    `, [salle_id, enseignant_id, groupe_ids, exclure]);

    // Occurrences libérées : demandes acceptées (annulation ou déplacement ponctuel)
    const liberees = new Map(); // seance_id -> Set de dates 'YYYY-MM-DD'
    const liberer = (seanceId, date) => {
        if (!liberees.has(seanceId)) liberees.set(seanceId, new Set());
        liberees.get(seanceId).add(date);
    };
    if (resSeances.rows.length > 0) {
        const resExc = await pool.query(`
            SELECT seance_id, date_occurrence FROM demande_changement
            WHERE statut = 'acceptee'
              AND type_demande IN ('annulation_ponctuelle', 'deplacement_ponctuel')
              AND seance_id = ANY($1::int[])
        `, [resSeances.rows.map((r) => r.seance_id)]);
        resExc.rows.forEach((r) => liberer(Number(r.seance_id), r.date_occurrence));
    }
    if (options.ignorerOccurrence) {
        liberer(Number(options.ignorerOccurrence.seance_id), options.ignorerOccurrence.date);
    }

    for (const s of resSeances.rows) {
        const occ = {
            salle_id: s.salle_id, enseignant_id: s.enseignant_id, groupe_ids: s.groupe_ids,
            creneau: { date_creneau: s.date_creneau, jour: s.jour, heure_debut: s.heure_debut, heure_fin: s.heure_fin },
            periode: { date_debut: s.edt_debut, date_fin: s.edt_fin },
        };
        if (!seChevauchent(occ)) continue;

        // Si le chevauchement tombe sur UNE date précise (un des deux est daté) et que cette
        // occurrence de la séance a été annulée/déplacée, la place est libre ce jour-là.
        const dateCommune = candidat.creneau.date_creneau || s.date_creneau;
        const dates = liberees.get(Number(s.seance_id));
        if (dateCommune && dates && dates.has(dateCommune)) continue;

        const ressource = ressourceEnConflit(occ);
        if (ressource) return { ressource, source: 'cours' };
    }

    // ---- 2. Occurrences déplacées (déplacement ponctuel accepté) ----
    const resDeplacees = await pool.query(`
        SELECT COALESCE(d.nouvelle_salle_id, s.salle_id) AS salle_id,
               s.enseignant_id,
               ARRAY(SELECT groupe_id FROM seance_groupe WHERE seance_id = s.id) AS groupe_ids,
               COALESCE(nc.date_creneau, d.date_occurrence) AS date_creneau,
               COALESCE(nc.heure_debut, oc.heure_debut) AS heure_debut,
               COALESCE(nc.heure_fin, oc.heure_fin) AS heure_fin
        FROM demande_changement d
        JOIN seance s ON s.id = d.seance_id
        JOIN creneau oc ON oc.id = s.creneau_id
        LEFT JOIN creneau nc ON nc.id = d.nouveau_creneau_id
        WHERE d.statut = 'acceptee' AND d.type_demande = 'deplacement_ponctuel'
          AND ($4::int IS NULL OR s.id <> $4)
          AND (COALESCE(d.nouvelle_salle_id, s.salle_id) = $1 OR s.enseignant_id = $2 OR EXISTS (
                SELECT 1 FROM seance_groupe sg WHERE sg.seance_id = s.id AND sg.groupe_id = ANY($3::int[])))
    `, [salle_id, enseignant_id, groupe_ids, exclure]);

    for (const d of resDeplacees.rows) {
        const occ = {
            salle_id: d.salle_id, enseignant_id: d.enseignant_id, groupe_ids: d.groupe_ids,
            creneau: { date_creneau: d.date_creneau, jour: getJourFromDate(d.date_creneau), heure_debut: d.heure_debut, heure_fin: d.heure_fin },
            periode: PERIODE_LARGE,
        };
        if (!seChevauchent(occ)) continue;
        const ressource = ressourceEnConflit(occ);
        if (ressource) return { ressource, source: 'deplacement' };
    }

    // ---- 3. Réservations confirmées ----
    const resResas = await pool.query(`
        SELECT r.salle_id, r.enseignant_id, r.groupe_id,
               c.date_creneau, c.jour, c.heure_debut, c.heure_fin
        FROM reservation r
        JOIN creneau c ON r.creneau_id = c.id
        WHERE r.statut = 'confirmee'
          AND (r.salle_id = $1 OR r.enseignant_id = $2 OR r.groupe_id = ANY($3::int[]))
    `, [salle_id, enseignant_id, groupe_ids]);

    for (const r of resResas.rows) {
        const occ = {
            salle_id: r.salle_id, enseignant_id: r.enseignant_id,
            groupe_ids: r.groupe_id ? [r.groupe_id] : [],
            creneau: { date_creneau: r.date_creneau, jour: r.jour, heure_debut: r.heure_debut, heure_fin: r.heure_fin },
            periode: PERIODE_LARGE,
        };
        if (!seChevauchent(occ)) continue;
        const ressource = ressourceEnConflit(occ);
        if (ressource) return { ressource, source: 'reservation' };
    }

    return null;
};

const MESSAGES = {
    cours: {
        salle: "La salle est déjà occupée par un cours (EDT) sur ce créneau.",
        enseignant: "L'enseignant a déjà un cours (EDT) sur ce créneau.",
        groupe: "Le groupe a déjà un cours (EDT) sur ce créneau.",
    },
    deplacement: {
        salle: "La salle est déjà occupée par un cours déplacé (changement accepté) sur ce créneau.",
        enseignant: "L'enseignant a déjà un cours déplacé (changement accepté) sur ce créneau.",
        groupe: "Le groupe a déjà un cours déplacé (changement accepté) sur ce créneau.",
    },
    reservation: {
        salle: "La salle a déjà une réservation confirmée sur ce créneau.",
        enseignant: "L'enseignant a déjà une réservation confirmée sur ce créneau.",
        groupe: "Le groupe a déjà une réservation confirmée sur ce créneau.",
    },
};

const messageConflit = ({ ressource, source }) => MESSAGES[source][ressource];

module.exports = { trouverConflit, messageConflit, PERIODE_LARGE };
const pool = require('../config/db');
const { journaliser } = require('./historiqueService');
const { notifier, notifierAdmins } = require('./notificationService');
const { aujourdHui } = require('../utils/timeUtils');

/*
 * ACTIVITÉ = HISTORIQUE + NOTIFICATIONS
 *
 * Chaque fonction décrit un événement du système : elle l'écrit dans l'historique et prévient les
 * personnes concernées. Le dernier paramètre `executor` est :
 *   - le pool (par défaut)  -> "au mieux" : une erreur est affichée dans la console mais ne fait JAMAIS
 *                              échouer l'opération principale
 *   - un client de transaction -> l'événement fait partie de la transaction : en cas d'erreur, tout est annulé
 *                              (utilisé pour les acceptations/confirmations, afin qu'aucune décision ne soit
 *                              prise sans trace)
 */

const executer = async (executor, travail) => {
    if (executor === pool) {
        try { await travail(); } catch (error) { console.error("Historique/notification impossible :", error); }
    } else {
        await travail();
    }
};

const h = (heure) => String(heure).slice(0, 5);
const quand = (c) => {
    const plage = `de ${h(c.heure_debut)} à ${h(c.heure_fin)}`;
    return c.date_creneau ? `le ${c.date_creneau} ${plage}` : `chaque ${c.jour} ${plage}`;
};
const TYPES_DEMANDE = {
    annulation_ponctuelle: 'annulation ponctuelle',
    deplacement_ponctuel: 'déplacement ponctuel',
    deplacement_definitif: 'déplacement définitif',
};

// ---------------------------------------------------------------- Descriptions lisibles

const lireReservation = async (id, executor = pool) => {
    const res = await executor.query(`
        SELECT r.id, r.statut, r.enseignant_id, r.salle_id, r.creneau_id, r.groupe_id,
               u.prenom || ' ' || u.nom AS enseignant, s.nom_salle, g.nom_groupe,
               c.date_creneau, c.jour, c.heure_debut, c.heure_fin
        FROM reservation r
        JOIN utilisateur u ON u.id = r.enseignant_id
        JOIN salle s ON s.id = r.salle_id
        JOIN creneau c ON c.id = r.creneau_id
        LEFT JOIN groupe g ON g.id = r.groupe_id
        WHERE r.id = $1
    `, [id]);
    const r = res.rows[0];
    if (!r) return null;
    return { ...r, texte: `salle « ${r.nom_salle} », ${quand(r)}${r.nom_groupe ? `, groupe ${r.nom_groupe}` : ''}` };
};
const instantaneReservation = (r) => r && ({
    statut: r.statut, salle_id: r.salle_id, creneau_id: r.creneau_id, groupe_id: r.groupe_id, enseignant_id: r.enseignant_id,
});

const lireDemande = async (id, executor = pool) => {
    const res = await executor.query(`
        SELECT d.id, d.type_demande, d.statut, d.date_occurrence, d.enseignant_id, d.seance_id,
               d.nouveau_creneau_id, d.nouvelle_salle_id,
               u.prenom || ' ' || u.nom AS enseignant, m.nom_module, ns.nom_salle AS nouvelle_salle,
               nc.date_creneau AS date_creneau, nc.jour AS jour, nc.heure_debut AS heure_debut, nc.heure_fin AS heure_fin
        FROM demande_changement d
        JOIN utilisateur u ON u.id = d.enseignant_id
        JOIN seance s ON s.id = d.seance_id
        JOIN module m ON m.id = s.module_id
        LEFT JOIN salle ns ON ns.id = d.nouvelle_salle_id
        LEFT JOIN creneau nc ON nc.id = d.nouveau_creneau_id
        WHERE d.id = $1
    `, [id]);
    const d = res.rows[0];
    if (!d) return null;
    const destination = [d.nouvelle_salle && `salle « ${d.nouvelle_salle} »`, d.heure_debut && quand(d)].filter(Boolean).join(', ');
    return {
        ...d,
        texte: `${TYPES_DEMANDE[d.type_demande]} de la séance « ${d.nom_module} »${d.date_occurrence ? ` du ${d.date_occurrence}` : ''}${destination ? ` → ${destination}` : ''}`,
    };
};
const instantaneDemande = (d) => d && ({
    statut: d.statut, type_demande: d.type_demande, date_occurrence: d.date_occurrence,
    nouveau_creneau_id: d.nouveau_creneau_id, nouvelle_salle_id: d.nouvelle_salle_id,
});

const lireSeance = async (id, executor = pool) => {
    const res = await executor.query(`
        SELECT s.id, s.edt_id, s.enseignant_id, s.module_id, s.salle_id, s.creneau_id, s.evenement_id,
               m.nom_module, sa.nom_salle, c.date_creneau, c.jour, c.heure_debut, c.heure_fin,
               ARRAY(SELECT groupe_id FROM seance_groupe WHERE seance_id = s.id ORDER BY groupe_id) AS groupe_ids
        FROM seance s
        JOIN module m ON m.id = s.module_id
        JOIN salle sa ON sa.id = s.salle_id
        JOIN creneau c ON c.id = s.creneau_id
        WHERE s.id = $1
    `, [id]);
    const s = res.rows[0];
    if (!s) return null;
    return { ...s, texte: `« ${s.nom_module} » (${s.nom_salle}, ${quand(s)})` };
};
const instantaneSeance = (s) => s && ({
    edt_id: s.edt_id, enseignant_id: s.enseignant_id, module_id: s.module_id, salle_id: s.salle_id,
    creneau_id: s.creneau_id, evenement_id: s.evenement_id, groupe_ids: s.groupe_ids,
});

// ---------------------------------------------------------------- Données de référence (historique seul)

// Accord en genre des actions : 'filiere.creee', 'salle.modifiee', mais 'equipement.supprime', 'groupe.cree'...
const FEMININ = new Set(['filiere', 'salle']);
const accord = (entite) => (FEMININ.has(entite) ? 'e' : '');

// entite : 'salle', 'equipement', 'evenement', 'creneau', 'niveau', 'filiere', 'groupe', 'module', 'edt'
const creation = (entite, ligne, utilisateur_id, executor = pool) => executer(executor, () => journaliser({
    action: `${entite}.cree${accord(entite)}`,
    entite, id_entite: ligne.id, nouvelle: ligne, utilisateur_id,
}, executor));

const modification = (entite, ancienne, nouvelle, utilisateur_id, executor = pool) => executer(executor, () => journaliser({
    action: `${entite}.modifie${accord(entite)}`,
    entite, id_entite: nouvelle.id, ancienne, nouvelle, utilisateur_id,
}, executor));

const suppression = (entite, ligne, utilisateur_id, executor = pool, complement = {}) => executer(executor, () => journaliser({
    action: `${entite}.supprime${accord(entite)}`,
    entite, id_entite: ligne.id, ancienne: { ...ligne, ...complement }, utilisateur_id,
}, executor));

// ---------------------------------------------------------------- Authentification

const inscription = (utilisateur) => executer(pool, () => journaliser({
    action: 'utilisateur.inscrit', entite: 'utilisateur', id_entite: utilisateur.id,
    nouvelle: { id: utilisateur.id, nom: utilisateur.nom, prenom: utilisateur.prenom, email: utilisateur.email, role: utilisateur.role },
    utilisateur_id: utilisateur.id,
}));
const connexion = (utilisateur_id) => executer(pool, () => journaliser({
    action: 'utilisateur.connexion', entite: 'utilisateur', id_entite: utilisateur_id, utilisateur_id,
}));
const echecConnexion = (utilisateur_id) => executer(pool, () => journaliser({
    action: 'utilisateur.echec_connexion', entite: 'utilisateur', id_entite: utilisateur_id, utilisateur_id,
}));

// ---------------------------------------------------------------- Refus automatiques (réservations et demandes)

// refusees : [{ type: 'reservation' | 'demande_changement', id, enseignant_id, motif }]
const refusAutomatiques = async (refusees, admin_id, executor) => {
    for (const r of refusees) {
        if (r.type === 'reservation') {
            const resa = await lireReservation(r.id, executor);
            await journaliser({
                action: 'reservation.refusee_auto', entite: 'reservation', id_entite: r.id,
                ancienne: { statut: 'en_attente' }, nouvelle: { statut: 'rejetee', motif_rejet: r.motif }, utilisateur_id: admin_id,
            }, executor);
            await notifier(r.enseignant_id, `Votre réservation (${resa.texte}) a été rejetée : ${r.motif}`, executor);
        } else {
            const dem = await lireDemande(r.id, executor);
            await journaliser({
                action: 'demande_changement.refusee_auto', entite: 'demande_changement', id_entite: r.id,
                ancienne: { statut: 'en_attente' }, nouvelle: { statut: 'refusee', motif_refus: r.motif }, utilisateur_id: admin_id,
            }, executor);
            await notifier(r.enseignant_id, `Votre demande de changement (${dem.texte}) a été refusée : ${r.motif}`, executor);
        }
    }
};

// ---------------------------------------------------------------- Réservations

const reservationDemandee = (reservationId, utilisateur_id, executor = pool) => executer(executor, async () => {
    const r = await lireReservation(reservationId, executor);
    await journaliser({
        action: 'reservation.demandee', entite: 'reservation', id_entite: r.id,
        nouvelle: instantaneReservation(r), utilisateur_id,
    }, executor);
    await notifierAdmins(`Nouvelle demande de réservation de ${r.enseignant} : ${r.texte}.`, executor, utilisateur_id);
});

const reservationRejetee = (reservationId, motif, admin_id, executor = pool) => executer(executor, async () => {
    const r = await lireReservation(reservationId, executor);
    await journaliser({
        action: 'reservation.rejetee', entite: 'reservation', id_entite: r.id,
        ancienne: { statut: 'en_attente' }, nouvelle: { statut: 'rejetee', motif_rejet: motif }, utilisateur_id: admin_id,
    }, executor);
    await notifier(r.enseignant_id, `Votre réservation (${r.texte}) a été rejetée : ${motif}`, executor);
});

const reservationConfirmee = (reservationId, admin_id, refusees = [], executor = pool) => executer(executor, async () => {
    const r = await lireReservation(reservationId, executor);
    await journaliser({
        action: 'reservation.confirmee', entite: 'reservation', id_entite: r.id,
        ancienne: { statut: 'en_attente' }, nouvelle: { statut: 'confirmee' }, utilisateur_id: admin_id,
    }, executor);
    await notifier(r.enseignant_id, `Votre réservation (${r.texte}) a été confirmée.`, executor);
    await refusAutomatiques(refusees, admin_id, executor);
});

// avant : la réservation telle qu'elle était avant la réaffectation (ligne SQL)
const reservationReaffectee = (avant, admin_id, refusees = [], executor = pool) => executer(executor, async () => {
    const r = await lireReservation(avant.id, executor);
    await journaliser({
        action: 'reservation.reaffectee', entite: 'reservation', id_entite: r.id,
        ancienne: instantaneReservation(avant), nouvelle: instantaneReservation(r), utilisateur_id: admin_id,
    }, executor);
    await notifier(r.enseignant_id, `Votre réservation a été réaffectée par l'administration et confirmée : ${r.texte}.`, executor);
    await refusAutomatiques(refusees, admin_id, executor);
});

// avant : la réservation telle qu'elle était avant l'annulation (ligne SQL)
const reservationAnnulee = (avant, utilisateur_id, executor = pool) => executer(executor, async () => {
    const r = await lireReservation(avant.id, executor);
    await journaliser({
        action: 'reservation.annulee', entite: 'reservation', id_entite: r.id,
        ancienne: { statut: avant.statut }, nouvelle: { statut: 'annulee' }, utilisateur_id,
    }, executor);
    if (avant.statut === 'confirmee') {
        await notifierAdmins(`${r.enseignant} a annulé sa réservation confirmée (${r.texte}).`, executor, utilisateur_id);
    }
});

// ---------------------------------------------------------------- Demandes de changement

const demandeCreee = (demandeId, utilisateur_id, executor = pool) => executer(executor, async () => {
    const d = await lireDemande(demandeId, executor);
    await journaliser({
        action: 'demande_changement.creee', entite: 'demande_changement', id_entite: d.id,
        nouvelle: instantaneDemande(d), utilisateur_id,
    }, executor);
    await notifierAdmins(`Nouvelle demande de changement de ${d.enseignant} : ${d.texte}.`, executor, utilisateur_id);
});

const demandeRefusee = (demandeId, motif, admin_id, executor = pool) => executer(executor, async () => {
    const d = await lireDemande(demandeId, executor);
    await journaliser({
        action: 'demande_changement.refusee', entite: 'demande_changement', id_entite: d.id,
        ancienne: { statut: 'en_attente' }, nouvelle: { statut: 'refusee', motif_refus: motif }, utilisateur_id: admin_id,
    }, executor);
    await notifier(d.enseignant_id, `Votre demande de changement (${d.texte}) a été refusée : ${motif}`, executor);
});

/**
 * Acceptation d'une demande (telle quelle ou réaffectée par l'admin).
 *   avantDemande / avantSeance : états AVANT la décision (lignes lues avant l'acceptation)
 *   reaffectee : true si l'admin a modifié la destination en acceptant
 */
const demandeAcceptee = (avantDemande, avantSeance, admin_id, refusees = [], reaffectee = false, executor = pool) => executer(executor, async () => {
    const d = await lireDemande(avantDemande.id, executor);
    await journaliser({
        action: reaffectee ? 'demande_changement.reaffectee' : 'demande_changement.acceptee',
        entite: 'demande_changement', id_entite: d.id,
        ancienne: instantaneDemande(avantDemande), nouvelle: instantaneDemande(d), utilisateur_id: admin_id,
    }, executor);
    // un déplacement définitif modifie la séance : on garde la trace de ce changement
    if (d.type_demande === 'deplacement_definitif') {
        const apres = await lireSeance(d.seance_id, executor);
        await journaliser({
            action: 'seance.modifiee', entite: 'seance', id_entite: d.seance_id,
            ancienne: { creneau_id: avantSeance.creneau_id, salle_id: avantSeance.salle_id },
            nouvelle: { creneau_id: apres.creneau_id, salle_id: apres.salle_id },
            utilisateur_id: admin_id,
        }, executor);
    }
    await notifier(d.enseignant_id, reaffectee
        ? `Votre demande de changement a été modifiée par l'administration puis acceptée : ${d.texte}.`
        : `Votre demande de changement (${d.texte}) a été acceptée.`, executor);
    await refusAutomatiques(refusees, admin_id, executor);
});

// ---------------------------------------------------------------- Séances et EDT

const seanceCreee = (seanceId, utilisateur_id, executor = pool) => executer(executor, async () => {
    const s = await lireSeance(seanceId, executor);
    await journaliser({
        action: 'seance.creee', entite: 'seance', id_entite: s.id, nouvelle: instantaneSeance(s), utilisateur_id,
    }, executor);
    await notifier(s.enseignant_id, `Une séance vous a été attribuée : ${s.texte}.`, executor);
});

// avant : résultat de lireSeance AVANT la modification
const seanceModifiee = (avant, utilisateur_id, executor = pool) => executer(executor, async () => {
    const apres = await lireSeance(avant.id, executor);
    await journaliser({
        action: 'seance.modifiee', entite: 'seance', id_entite: avant.id,
        ancienne: instantaneSeance(avant), nouvelle: instantaneSeance(apres), utilisateur_id,
    }, executor);
    if (Number(avant.enseignant_id) !== Number(apres.enseignant_id)) {
        await notifier(avant.enseignant_id, `Vous n'êtes plus affecté à la séance ${avant.texte}.`, executor);
        await notifier(apres.enseignant_id, `Une séance vous a été attribuée : ${apres.texte}.`, executor);
    } else {
        await notifier(apres.enseignant_id, `Votre séance a été modifiée : ${avant.texte} → ${apres.texte}.`, executor);
    }
});

const seanceSupprimee = (avant, utilisateur_id, executor = pool) => executer(executor, async () => {
    await journaliser({
        action: 'seance.supprimee', entite: 'seance', id_entite: avant.id, ancienne: instantaneSeance(avant), utilisateur_id,
    }, executor);
    await notifier(avant.enseignant_id, `Votre séance a été supprimée : ${avant.texte}.`, executor);
});

// Supprimer un EDT supprime ses séances : chaque enseignant concerné est prévenu
// resume : { seances: [ids], enseignants: [{ enseignant_id, nb }] }
const edtSupprime = (edt, resume, utilisateur_id, executor = pool) => executer(executor, async () => {
    await journaliser({
        action: 'edt.supprime', entite: 'edt', id_entite: edt.id,
        ancienne: { ...edt, seances_supprimees: resume.seances }, utilisateur_id,
    }, executor);
    for (const e of resume.enseignants) {
        await notifier(e.enseignant_id,
            `L'emploi du temps « ${edt.titre} » a été supprimé : ${e.nb} de vos séances ${e.nb > 1 ? 'ont' : 'a'} été supprimée${e.nb > 1 ? 's' : ''}.`, executor);
    }
});

// ---------------------------------------------------------------- Salles

const ETATS = { en_maintenance: 'maintenance', indisponible: 'indisponible' };

const salleModifiee = (ancienne, nouvelle, utilisateur_id, executor = pool) => executer(executor, async () => {
    await journaliser({
        action: 'salle.modifiee', entite: 'salle', id_entite: nouvelle.id,
        ancienne: { nom_salle: ancienne.nom_salle, capacite: ancienne.capacite, type_salle: ancienne.type_salle, etat: ancienne.etat },
        nouvelle: { nom_salle: nouvelle.nom_salle, capacite: nouvelle.capacite, type_salle: nouvelle.type_salle, etat: nouvelle.etat },
        utilisateur_id,
    }, executor);

    // Une salle qui devient indisponible : les admins sont prévenus de ce qui est touché, à eux d'adapter les séances
    if (ancienne.etat !== nouvelle.etat && nouvelle.etat !== 'disponible') {
        const aujourdhui = aujourdHui();
        const seances = await executor.query(`
            SELECT COUNT(*) FROM seance s
            JOIN edt e ON e.id = s.edt_id
            JOIN creneau c ON c.id = s.creneau_id
            WHERE s.salle_id = $1 AND (CASE WHEN c.date_creneau IS NOT NULL THEN c.date_creneau >= $2::date ELSE e.date_fin >= $2::date END)
        `, [nouvelle.id, aujourdhui]);
        const reservations = await executor.query(`
            SELECT COUNT(*) FROM reservation r JOIN creneau c ON c.id = r.creneau_id
            WHERE r.salle_id = $1 AND r.statut = 'confirmee' AND c.date_creneau >= $2::date
        `, [nouvelle.id, aujourdhui]);
        const nbSeances = Number(seances.rows[0].count);
        const nbResas = Number(reservations.rows[0].count);
        const etat = ETATS[nouvelle.etat] || nouvelle.etat;
        const impact = nbSeances + nbResas === 0
            ? "aucune séance ni réservation confirmée à venir ne l'utilise."
            : `${nbSeances} séance(s) et ${nbResas} réservation(s) confirmée(s) à venir l'utilisent : pensez à les adapter.`;
        await notifierAdmins(`La salle « ${nouvelle.nom_salle} » est passée en ${etat} : ${impact}`, executor, utilisateur_id);
    }
});

module.exports = {
    lireSeance, instantaneSeance,
    creation, modification, suppression,
    inscription, connexion, echecConnexion,
    reservationDemandee, reservationRejetee, reservationConfirmee, reservationReaffectee, reservationAnnulee,
    demandeCreee, demandeRefusee, demandeAcceptee,
    seanceCreee, seanceModifiee, seanceSupprimee, edtSupprime,
    salleModifiee,
};
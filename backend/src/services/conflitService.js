const pool = require('../config/db');
const { checkTimeOverlap, checkDateOverlap, getJourFromDate, aujourdHui } = require('../utils/timeUtils');
const { trouverConflit, PERIODE_LARGE } = require('./disponibiliteService');
const demandeModel = require('../models/demandeChangementModel');
const { notifierAdmins } = require('./notificationService');

/*
 * GESTION DES CONFLITS
 *
 * Une "occupation" est la place qu'une demande EN ATTENTE prendrait si elle était acceptée :
 *   - une réservation : sa salle, son créneau (daté), son enseignant, son groupe
 *   - un déplacement ponctuel : la nouvelle date/heure/salle de l'occurrence déplacée
 *   - un déplacement définitif : le nouveau créneau/salle de la séance (sur la période de l'EDT)
 * (une annulation n'occupe rien)
 *
 * Deux types de conflits sont enregistrés :
 *   1. CONCURRENCE : plusieurs demandes en attente se disputent la même ressource (salle, enseignant ou groupe)
 *   2. BLOQUÉE     : des demandes en attente visent une place déjà prise (par un cours de l'EDT,
 *                    une occurrence déplacée ou une réservation confirmée), par exemple après une
 *                    modification de séance par l'admin
 */

const heure = (h) => String(h).slice(0, 5);

// ---------------------------------------------------------------- Occupations

const occupationReservation = (r) => ({
    type: 'reservation', id: Number(r.id), cle: `R${r.id}`, seance_id: null,
    salle_id: Number(r.salle_id), enseignant_id: Number(r.enseignant_id),
    groupe_ids: r.groupe_id ? [Number(r.groupe_id)] : [],
    creneau: { date_creneau: r.date_creneau, jour: r.jour, heure_debut: r.heure_debut, heure_fin: r.heure_fin },
    periode: PERIODE_LARGE,
    options: {},
});

// d = ligne issue de SQL_DEMANDES (ou construite par occupationDemandeDepuis)
const occupationDemande = (d) => {
    if (d.type_demande === 'annulation_ponctuelle') return null; // une annulation n'occupe rien
    const ponctuel = d.type_demande === 'deplacement_ponctuel';
    let creneau;
    if (d.n_debut) {
        creneau = { date_creneau: d.n_date, jour: d.n_jour, heure_debut: d.n_debut, heure_fin: d.n_fin };
    } else if (ponctuel) {
        creneau = { date_creneau: d.date_occurrence, jour: getJourFromDate(d.date_occurrence), heure_debut: d.o_debut, heure_fin: d.o_fin };
    } else {
        creneau = { date_creneau: d.o_date, jour: d.o_jour, heure_debut: d.o_debut, heure_fin: d.o_fin };
    }
    return {
        type: 'demande_changement', id: Number(d.id), cle: `D${d.id}`, seance_id: Number(d.seance_id),
        salle_id: Number(d.nouvelle_salle_id || d.salle_seance), enseignant_id: Number(d.enseignant_seance),
        groupe_ids: (d.groupe_ids || []).map(Number),
        creneau,
        periode: ponctuel ? PERIODE_LARGE : { date_debut: d.edt_debut, date_fin: d.edt_fin },
        // pour interroger le moteur sans entrer en conflit avec la séance elle-même
        options: ponctuel
            ? { ignorerOccurrence: { seance_id: Number(d.seance_id), date: d.date_occurrence } }
            : { exclureSeanceId: Number(d.seance_id) },
    };
};

// Occupation d'une séance de l'EDT (détails fournis par demandeChangementModel.getSeanceDetails)
const occupationSeance = (s) => ({
    type: 'seance', id: Number(s.id), cle: `S${s.id}`, seance_id: Number(s.id),
    salle_id: Number(s.salle_id), enseignant_id: Number(s.enseignant_id),
    groupe_ids: (s.groupe_ids || []).map(Number),
    creneau: { date_creneau: s.date_creneau, jour: s.jour, heure_debut: s.heure_debut, heure_fin: s.heure_fin },
    periode: { date_debut: s.edt_debut, date_fin: s.edt_fin },
    options: { exclureSeanceId: Number(s.id) },
});

// Occupation d'une demande dont on connaît la séance et le nouveau créneau (réaffectation, acceptation)
const occupationDemandeDepuis = (demande, seance, nouveauCreneau) => occupationDemande({
    id: demande.id, type_demande: demande.type_demande, date_occurrence: demande.date_occurrence,
    seance_id: seance.id, nouvelle_salle_id: demande.nouvelle_salle_id,
    enseignant_seance: seance.enseignant_id, salle_seance: seance.salle_id,
    o_date: seance.date_creneau, o_jour: seance.jour, o_debut: seance.heure_debut, o_fin: seance.heure_fin,
    n_date: nouveauCreneau ? nouveauCreneau.date_creneau : null,
    n_jour: nouveauCreneau ? nouveauCreneau.jour : null,
    n_debut: nouveauCreneau ? nouveauCreneau.heure_debut : null,
    n_fin: nouveauCreneau ? nouveauCreneau.heure_fin : null,
    edt_debut: seance.edt_debut, edt_fin: seance.edt_fin, groupe_ids: seance.groupe_ids,
});

const SQL_DEMANDES = `
    SELECT d.id, d.type_demande, d.date_occurrence, d.seance_id, d.nouvelle_salle_id,
           s.enseignant_id AS enseignant_seance, s.salle_id AS salle_seance,
           oc.date_creneau AS o_date, oc.jour AS o_jour, oc.heure_debut AS o_debut, oc.heure_fin AS o_fin,
           nc.date_creneau AS n_date, nc.jour AS n_jour, nc.heure_debut AS n_debut, nc.heure_fin AS n_fin,
           e.date_debut AS edt_debut, e.date_fin AS edt_fin,
           ARRAY(SELECT groupe_id FROM seance_groupe WHERE seance_id = s.id) AS groupe_ids
    FROM demande_changement d
    JOIN seance s ON s.id = d.seance_id
    JOIN creneau oc ON oc.id = s.creneau_id
    JOIN edt e ON e.id = s.edt_id
    LEFT JOIN creneau nc ON nc.id = d.nouveau_creneau_id
    WHERE d.statut = 'en_attente' AND d.type_demande <> 'annulation_ponctuelle'
`;

// Occupations encore pertinentes (on ignore ce qui est déjà passé)
const estActive = (occ) => {
    const today = aujourdHui();
    return occ.creneau.date_creneau ? occ.creneau.date_creneau >= today : occ.periode.date_fin >= today;
};

const chargerOccupationsEnAttente = async () => {
    const resas = await pool.query(`
        SELECT r.id, r.salle_id, r.enseignant_id, r.groupe_id, c.date_creneau, c.jour, c.heure_debut, c.heure_fin
        FROM reservation r JOIN creneau c ON c.id = r.creneau_id
        WHERE r.statut = 'en_attente'
    `);
    const dems = await pool.query(SQL_DEMANDES);
    return [
        ...resas.rows.map(occupationReservation),
        ...dems.rows.map(occupationDemande),
    ].filter((o) => o && estActive(o));
};

// ---------------------------------------------------------------- Chevauchements

// Ressources partagées (salle / enseignant / groupe) si les deux occupations se chevauchent dans le temps
const ressourcesEnCommun = (a, b) => {
    if (a.seance_id && a.seance_id === b.seance_id) return []; // deux demandes d'une même séance ne se disputent rien
    const memeMoment = checkDateOverlap(a.creneau, b.creneau, a.periode, b.periode) && checkTimeOverlap(a.creneau, b.creneau);
    if (!memeMoment) return [];
    const communes = [];
    if (a.salle_id === b.salle_id) communes.push({ type: 'salle', id: a.salle_id });
    if (a.enseignant_id === b.enseignant_id) communes.push({ type: 'enseignant', id: a.enseignant_id });
    a.groupe_ids.filter((g) => b.groupe_ids.includes(g)).forEach((g) => communes.push({ type: 'groupe', id: g }));
    return communes;
};

// Demandes en attente qui se disputent une ressource avec `occ` (hors `occ` elle-même)
const trouverConcurrents = async (occ) => {
    const toutes = await chargerOccupationsEnAttente();
    return toutes.filter((o) => o.cle !== occ.cle && ressourcesEnCommun(occ, o).length > 0);
};

// Regroupe les occupations qui se chevauchent sur une même ressource (composantes connexes)
const calculerConcurrences = (occs) => {
    const aretes = new Map(); // "type:id" -> [[i, j], ...]
    for (let i = 0; i < occs.length; i++) {
        for (let j = i + 1; j < occs.length; j++) {
            for (const r of ressourcesEnCommun(occs[i], occs[j])) {
                const cle = `${r.type}:${r.id}`;
                if (!aretes.has(cle)) aretes.set(cle, []);
                aretes.get(cle).push([i, j]);
            }
        }
    }
    const clusters = [];
    for (const [cle, paires] of aretes) {
        const parent = new Map();
        const trouver = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
        paires.forEach(([i, j]) => {
            if (!parent.has(i)) parent.set(i, i);
            if (!parent.has(j)) parent.set(j, j);
            parent.set(trouver(i), trouver(j));
        });
        const composantes = new Map();
        for (const x of parent.keys()) {
            const racine = trouver(x);
            if (!composantes.has(racine)) composantes.set(racine, []);
            composantes.get(racine).push(occs[x]);
        }
        const [type, id] = cle.split(':');
        for (const membres of composantes.values()) clusters.push({ type, ressource_id: Number(id), membres });
    }
    return clusters;
};

// ---------------------------------------------------------------- Description lisible

const LABELS = { salle: 'Salle', enseignant: 'Enseignant', groupe: 'Groupe' };
const SOURCES = {
    cours: 'un cours (EDT)', deplacement: 'un cours déplacé', reservation: 'une réservation confirmée',
};

const quand = (occ) => {
    const c = occ.creneau;
    const plage = `de ${heure(c.heure_debut)} à ${heure(c.heure_fin)}`;
    return c.date_creneau ? `le ${c.date_creneau} ${plage}` : `chaque ${c.jour} ${plage}`;
};

const chargerNoms = async () => {
    const [salles, users, groupes] = await Promise.all([
        pool.query('SELECT id, nom_salle AS nom FROM salle'),
        pool.query("SELECT id, (prenom || ' ' || nom) AS nom FROM utilisateur"),
        pool.query('SELECT id, nom_groupe AS nom FROM groupe'),
    ]);
    const table = (res) => new Map(res.rows.map((r) => [Number(r.id), r.nom]));
    return { salle: table(salles), enseignant: table(users), groupe: table(groupes) };
};

const signature = (type, cles) => `${type}|${[...cles].sort().join(',')}`;

// ---------------------------------------------------------------- Calcul des conflits

const calculerConflits = async () => {
    const occs = await chargerOccupationsEnAttente();
    if (occs.length === 0) return [];

    // 2. Demandes BLOQUÉES par une place déjà prise
    const bloquees = new Map(); // cle d'occupation -> { ressource, ressource_id, source }
    for (const occ of occs) {
        const conflit = await trouverConflit({
            enseignant_id: occ.enseignant_id, salle_id: occ.salle_id, groupe_ids: occ.groupe_ids,
            creneau: occ.creneau, periode: occ.periode,
        }, occ.options);
        if (conflit) bloquees.set(occ.cle, conflit);
    }

    const noms = await chargerNoms();
    const resultat = [];

    // Les demandes bloquées pour la même raison (même ressource, même moment, même cause) sont regroupées
    const groupesBloquees = new Map();
    for (const occ of occs) {
        const b = bloquees.get(occ.cle);
        if (!b) continue;
        const cle = `${b.ressource}|${b.ressource_id}|${b.source}|${quand(occ)}`;
        if (!groupesBloquees.has(cle)) groupesBloquees.set(cle, { b, membres: [] });
        groupesBloquees.get(cle).membres.push(occ);
    }
    for (const { b, membres } of groupesBloquees.values()) {
        const nom = noms[b.ressource].get(b.ressource_id) || `#${b.ressource_id}`;
        const description = `${LABELS[b.ressource]} « ${nom} » — ${quand(membres[0])} : ${membres.length > 1 ? 'demandes bloquées' : 'demande bloquée'} par ${SOURCES[b.source]}`;
        resultat.push({ type: b.ressource, description, membres });
    }

    // 1. CONCURRENCES entre demandes en attente (sauf si tous les membres sont de toute façon bloqués sur cette ressource)
    for (const cl of calculerConcurrences(occs)) {
        const tousBloques = cl.membres.every((m) => bloquees.has(m.cle) && bloquees.get(m.cle).ressource === cl.type);
        if (tousBloques) continue;
        const nom = noms[cl.type].get(cl.ressource_id) || `#${cl.ressource_id}`;
        const description = `${LABELS[cl.type]} « ${nom} » — ${quand(cl.membres[0])} : ${cl.membres.length} demandes en concurrence`;
        resultat.push({ type: cl.type, description, membres: cl.membres });
    }

    return resultat.map((c) => ({
        type: c.type,
        description: c.description.slice(0, 255),
        reservations: c.membres.filter((m) => m.type === 'reservation').map((m) => m.id),
        demandes: c.membres.filter((m) => m.type === 'demande_changement').map((m) => m.id),
        signature: signature(c.type, c.membres.map((m) => m.cle)),
    }));
};

// ---------------------------------------------------------------- Synchronisation en base

// Met la table `conflit` en phase avec les demandes en attente actuelles :
//   - un conflit identique est conservé tel quel
//   - un conflit qui GAGNE ou PERD des demandes garde son identité (même ligne, même date de détection)
//   - un conflit qui n'existe plus passe à 'resolu' ; un conflit vraiment nouveau est créé
const recalculerConflits = async () => {
    const calcules = await calculerConflits();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(424242)'); // une seule synchronisation à la fois

        const ouverts = await client.query(`
            SELECT c.id, c.type_conflit, c.description,
                   ARRAY(SELECT reservation_id FROM conflit_reservation WHERE conflit_id = c.id) AS reservations,
                   ARRAY(SELECT demande_changement_id FROM conflit_demande WHERE conflit_id = c.id) AS demandes
            FROM conflit c WHERE c.statut = 'ouvert' ORDER BY c.id
        `);
        const anciens = ouverts.rows.map((r) => {
            const cles = [...r.reservations.map((i) => `R${i}`), ...r.demandes.map((i) => `D${i}`)];
            return { ...r, cles: new Set(cles), signature: signature(r.type_conflit, cles), apparie: false };
        });
        const aCreer = [];

        const ecrireMembres = async (conflitId, c) => {
            await client.query('DELETE FROM conflit_reservation WHERE conflit_id = $1', [conflitId]);
            await client.query('DELETE FROM conflit_demande WHERE conflit_id = $1', [conflitId]);
            for (const rid of c.reservations) {
                await client.query('INSERT INTO conflit_reservation (conflit_id, reservation_id) VALUES ($1, $2)', [conflitId, rid]);
            }
            for (const did of c.demandes) {
                await client.query('INSERT INTO conflit_demande (conflit_id, demande_changement_id) VALUES ($1, $2)', [conflitId, did]);
            }
        };

        // 1. Conflits identiques (même type, mêmes demandes)
        const restants = [];
        for (const c of calcules) {
            const identique = anciens.find((a) => !a.apparie && a.signature === c.signature);
            if (identique) {
                identique.apparie = true;
                if (identique.description !== c.description) {
                    await client.query('UPDATE conflit SET description = $1 WHERE id = $2', [c.description, identique.id]);
                }
            } else {
                restants.push(c);
            }
        }
        // 2. Conflits qui ont grandi ou rétréci : même type et au moins une demande en commun
        for (const c of restants) {
            const cles = new Set([...c.reservations.map((i) => `R${i}`), ...c.demandes.map((i) => `D${i}`)]);
            const proche = anciens.find((a) => !a.apparie && a.type_conflit === c.type && [...a.cles].some((k) => cles.has(k)));
            if (proche) {
                proche.apparie = true;
                await client.query('UPDATE conflit SET description = $1 WHERE id = $2', [c.description, proche.id]);
                await ecrireMembres(proche.id, c);
            } else {
                aCreer.push(c);
            }
        }
        // 3. Conflits qui n'existent plus → résolus
        const aResoudre = anciens.filter((a) => !a.apparie).map((a) => a.id);
        if (aResoudre.length > 0) {
            await client.query("UPDATE conflit SET statut = 'resolu' WHERE id = ANY($1::int[])", [aResoudre]);
        }
        // 4. Vrais nouveaux conflits
        for (const c of aCreer) {
            const ins = await client.query(
                "INSERT INTO conflit (type_conflit, statut, description) VALUES ($1, 'ouvert', $2) RETURNING id",
                [c.type, c.description]);
            await ecrireMembres(ins.rows[0].id, c);
            await notifierAdmins(`Nouveau conflit : ${c.description}`, client);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// Les conflits sont des données DÉRIVÉES : une erreur ici ne doit jamais faire échouer l'opération principale.
const recalculerConflitsSansErreur = async () => {
    try {
        await recalculerConflits();
    } catch (error) {
        console.error('Recalcul des conflits impossible :', error);
    }
};

// ---------------------------------------------------------------- Acceptation avec refus des concurrentes

const refuserConcurrent = async (client, concurrent, motif, admin_id) => {
    const res = concurrent.type === 'reservation'
        ? await client.query(`
            UPDATE reservation SET statut = 'rejetee', motif_rejet = $1, admin_id = $2, date_traitement = NOW()
            WHERE id = $3 AND statut = 'en_attente' RETURNING id, enseignant_id`, [motif, admin_id, concurrent.id])
        : await client.query(`
            UPDATE demande_changement SET statut = 'refusee', motif_refus = $1, admin_id = $2, date_traitement = NOW()
            WHERE id = $3 AND statut = 'en_attente' RETURNING id, enseignant_id`, [motif, admin_id, concurrent.id]);
    return res.rows.length > 0
        ? { type: concurrent.type, id: concurrent.id, enseignant_id: res.rows[0].enseignant_id }
        : null;
};

const libelleOccupation = (occ) => (occ.type === 'reservation' ? `la réservation n°${occ.id}` : `la demande de changement n°${occ.id}`);

/**
 * Accepte une demande ET refuse automatiquement, dans la MÊME transaction, les demandes en attente
 * qui se disputaient la même place.
 *   occupation          : place prise par la demande acceptée (null pour une annulation : rien à refuser)
 *   appliquerAcceptation: async (client) => ligne mise à jour, ou null si déjà traitée
 *   surDecision         : (facultatif) async (client, { resultat, refusees }) => ... exécuté DANS la transaction
 *                         (historique et notifications : si elles échouent, tout est annulé)
 * Retourne { resultat, refusees: [{ type, id }] }
 */
const accepterEnRefusantConcurrents = async (occupation, appliquerAcceptation, admin_id, libelleAcceptee, surDecision = null) => {
    const concurrents = occupation ? await trouverConcurrents(occupation) : [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultat = await appliquerAcceptation(client);
        if (!resultat) {
            await client.query('ROLLBACK');
            return { resultat: null, refusees: [] };
        }
        const motif = `Conflit : la place a été attribuée à ${libelleAcceptee || (occupation ? libelleOccupation(occupation) : 'une autre demande')}.`;
        const detail = [];
        for (const c of concurrents) {
            const refusee = await refuserConcurrent(client, c, motif, admin_id);
            if (refusee) detail.push({ ...refusee, motif });
        }
        if (surDecision) await surDecision(client, { resultat, refusees: detail });
        await client.query('COMMIT');
        return { resultat, refusees: detail.map(({ type, id }) => ({ type, id })) };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// Demandes en attente qui entrent en conflit avec une séance (utilisé quand l'admin ajoute/modifie une séance)
const demandesImpacteesParSeance = async (seanceDetails) => {
    const concurrents = await trouverConcurrents(occupationSeance(seanceDetails));
    return concurrents.map((c) => ({
        type: c.type,
        id: c.id,
        enseignant_id: c.enseignant_id,
    }));
};

// Idem à partir de l'identifiant de la séance ; ne fait jamais échouer l'opération principale
const impactDeSeance = async (seanceId) => {
    try {
        const details = await demandeModel.getSeanceDetails(seanceId);
        return details ? await demandesImpacteesParSeance(details) : [];
    } catch (error) {
        console.error("Calcul des demandes impactées impossible :", error);
        return [];
    }
};

module.exports = {
    impactDeSeance,
    occupationReservation, occupationDemandeDepuis, occupationSeance,
    trouverConcurrents, calculerConflits, recalculerConflits, recalculerConflitsSansErreur,
    accepterEnRefusantConcurrents, demandesImpacteesParSeance,
};
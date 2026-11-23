const request = require('supertest');
const app = require('../src/app');
const { pool, resetDb, seed, tokenFor, FAKE_TIMERS, NOW } = require('./helpers');

let ids, adminToken, ens1Token, ens2Token;

beforeAll(() => jest.useFakeTimers(FAKE_TIMERS));
afterAll(async () => {
    jest.useRealTimers();
    await pool.end();
});

beforeEach(async () => {
    jest.setSystemTime(NOW);
    await resetDb();
    ids = await seed();
    adminToken = tokenFor({ id: ids.admin, role: 'admin' });
    ens1Token = tokenFor({ id: ids.ens1, role: 'enseignant' });
    ens2Token = tokenFor({ id: ids.ens2, role: 'enseignant' });
});

// ---------- Outils ----------
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const api = (method, url, token, body) => {
    const r = request(app)[method](url).set(auth(token));
    return body === undefined ? r : r.send(body);
};

// Réservations (en attente par défaut). Par défaut : Salle A, mardi 15 déc. 8h-10h.
const reserver = (token, o = {}) => api('post', '/api/reservations', token, {
    salle_id: ids.salleA, creneau_id: ids.d1215, groupe_id: ids.g1, evenement_id: ids.cours, ...o,
});
const creerResa = async (token, o) => {
    const r = await reserver(token, o);
    expect(r.status).toBe(201);
    return r.body.reservation;
};
const traiterResa = (id, body, token = adminToken) => api('put', `/api/reservations/${id}/traiter`, token, body);
const reaffecterResa = (id, body, token = adminToken) => api('put', `/api/reservations/${id}/reaffecter`, token, body);

// Séances (EDT S1). Par défaut : ens1, Salle A, lundi 8h-10h récurrent, groupe G1.
const corpsSeance = (o = {}) => ({
    enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
    creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1], ...o,
});
const ajouterSeance = (o) => api('post', `/api/edts/${ids.s1}/seances`, adminToken, corpsSeance(o));
const creerSeance = async (o) => {
    const r = await ajouterSeance(o);
    expect(r.status).toBe(201);
    return r.body.seance;
};

// Demandes de changement
const demander = (token, body) => api('post', '/api/demandes-changement', token, body);
const creerDemande = async (token, body) => {
    const r = await demander(token, body);
    expect(r.status).toBe(201);
    return r.body.demande;
};
const traiterDemande = (id, body, token = adminToken) => api('put', `/api/demandes-changement/${id}/traiter`, token, body);
const reaffecterDemande = (id, body, token = adminToken) => api('put', `/api/demandes-changement/${id}/reaffecter`, token, body);
const ponctuel = (s, o = {}) => ({ type_demande: 'deplacement_ponctuel', seance_id: s.id, date_occurrence: '2026-12-14', ...o });
const definitif = (s, o = {}) => ({ type_demande: 'deplacement_definitif', seance_id: s.id, ...o });

const conflits = async (qs = '') => (await api('get', `/api/conflits${qs}`, adminToken)).body;
const nouveauCreneau = async (date, jour, debut, fin) => (await pool.query(
    'INSERT INTO creneau (date_creneau, jour, heure_debut, heure_fin) VALUES ($1, $2, $3, $4) RETURNING id',
    [date, jour, debut, fin])).rows[0].id;
const statutResa = async (id) => (await pool.query('SELECT * FROM reservation WHERE id = $1', [id])).rows[0];
const statutDemande = async (id) => (await pool.query('SELECT * FROM demande_changement WHERE id = $1', [id])).rows[0];
const seanceEnBase = async (id) => (await pool.query('SELECT * FROM seance WHERE id = $1', [id])).rows[0];

// Deux réservations en concurrence sur la Salle A le mardi 15 déc. : ens1/G1 et ens2/G2
const deuxResasEnConcurrence = async () => [
    await creerResa(ens1Token, { groupe_id: ids.g1 }),
    await creerResa(ens2Token, { groupe_id: ids.g2 }),
];

// ============================================================
describe('Conflits - accès', () => {
    test('sans token → 401', async () => {
        expect((await request(app).get('/api/conflits')).status).toBe(401);
    });
    test('un enseignant ne peut pas consulter les conflits → 403', async () => {
        expect((await api('get', '/api/conflits', ens1Token)).status).toBe(403);
    });
    test('statut invalide → 400', async () => {
        expect((await api('get', '/api/conflits?statut=nimporte', adminToken)).status).toBe(400);
    });
    test('les routes de réaffectation sont réservées à l’admin → 403', async () => {
        const [r1] = await deuxResasEnConcurrence();
        expect((await reaffecterResa(r1.id, { salle_id: ids.salleB }, ens1Token)).status).toBe(403);
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, ponctuel(s, { nouvelle_salle_id: ids.salleB }));
        expect((await reaffecterDemande(d.id, { nouvelle_salle_id: ids.pile }, ens1Token)).status).toBe(403);
    });
});

// ============================================================
describe('Conflits - détection des demandes en concurrence', () => {
    test('aucune demande → aucun conflit', async () => {
        expect(await conflits()).toEqual([]);
    });

    test('une seule demande → aucun conflit', async () => {
        await creerResa(ens1Token);
        expect(await conflits()).toEqual([]);
    });

    test('deux réservations sur la même salle au même moment → 1 conflit « salle »', async () => {
        const [r1, r2] = await deuxResasEnConcurrence();
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0]).toMatchObject({ type_conflit: 'salle', statut: 'ouvert' });
        expect(liste[0].description).toMatch(/Salle « Salle A » — le 2026-12-15 de 08:00 à 10:00 : 2 demandes en concurrence/);
        expect(liste[0].date_detection).toBeTruthy();
        expect(liste[0].demandes).toEqual([]);
        expect(liste[0].reservations.map((r) => r.id)).toEqual([r1.id, r2.id]);
        expect(liste[0].reservations[0]).toMatchObject({
            statut: 'en_attente', nom_salle: 'Salle A', nom_groupe: 'G1', enseignant_nom: 'Alami',
            date_creneau: '2026-12-15', heure_debut: '08:00:00', heure_fin: '10:00:00',
        });
    });

    test('même enseignant dans deux salles au même moment → conflit « enseignant »', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        await creerResa(ens1Token, { groupe_id: ids.g2, salle_id: ids.salleB });
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].type_conflit).toBe('enseignant');
        expect(liste[0].description).toMatch(/Enseignant/);
    });

    test('même groupe dans deux salles au même moment → conflit « groupe »', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.salleB });
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].type_conflit).toBe('groupe');
        expect(liste[0].description).toMatch(/Groupe « G1 »/);
    });

    test('trois demandes pour le même groupe au même moment → un seul conflit « groupe » à 3 demandes', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1, salle_id: ids.salleA });
        await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.salleB });
        await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.amphi });
        const groupe = (await conflits()).filter((c) => c.type_conflit === 'groupe');
        expect(groupe).toHaveLength(1);
        expect(groupe[0].reservations).toHaveLength(3);
        expect(groupe[0].description).toMatch(/Groupe « G1 ».*3 demandes en concurrence/);
    });

    test('une séance à plusieurs groupes : un seul groupe en commun suffit pour un conflit', async () => {
        const s = await creerSeance({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g2] });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.pile }));
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.salleB }); // même moment, seul G2 en commun
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].type_conflit).toBe('groupe');
        expect(liste[0].description).toMatch(/Groupe « G2 »/);
        expect(liste[0].demandes.map((x) => x.id)).toEqual([d.id]);
        expect(liste[0].reservations.map((x) => x.id)).toEqual([r.id]);
    });

    test('deux demandes qui partagent la salle ET le groupe → un conflit par ressource partagée', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        await creerResa(ens2Token, { groupe_id: ids.g1 }); // même salle, même groupe, enseignants différents
        const types = (await conflits()).map((c) => c.type_conflit).sort();
        expect(types).toEqual(['groupe', 'salle']);
    });

    test('chevauchement partiel (8h-10h et 9h-11h) → conflit', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214b });
        expect(await conflits()).toHaveLength(1);
    });

    test('créneaux qui se touchent (8h-10h puis 10h-12h) → pas de conflit', async () => {
        const dix = await nouveauCreneau('2026-12-14', 'lundi', '10:00', '12:00');
        await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: dix });
        expect(await conflits()).toEqual([]);
    });

    test('salles, enseignants et groupes différents au même moment → pas de conflit', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.salleB });
        expect(await conflits()).toEqual([]);
    });

    test('même salle mais jours différents → pas de conflit', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1215 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1216 });
        expect(await conflits()).toEqual([]);
    });

    test('chaîne A (8h-10h), B (9h-11h), C (10h-12h) → un seul conflit à 3 demandes', async () => {
        const dix = await nouveauCreneau('2026-12-14', 'lundi', '10:00', '12:00');
        await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214b });
        await creerResa(ens1Token, { groupe_id: ids.g3, creneau_id: dix });
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].reservations).toHaveLength(3);
        expect(liste[0].description).toMatch(/3 demandes en concurrence/);
    });

    test('un conflit qui grandit puis rétrécit garde la même identité (jamais « résolu » à tort)', async () => {
        const dix = await nouveauCreneau('2026-12-14', 'lundi', '10:00', '12:00');
        const a = await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214b });
        const avant = await conflits();
        expect(avant).toHaveLength(1);

        await creerResa(ens1Token, { groupe_id: ids.g3, creneau_id: dix }); // une 3e demande rejoint le conflit
        const grandi = await conflits();
        expect(grandi).toHaveLength(1);
        expect(grandi[0].id).toBe(avant[0].id);
        expect(grandi[0].statut).toBe('ouvert');
        expect(grandi[0].reservations).toHaveLength(3);
        expect(grandi[0].date_detection).toBe(avant[0].date_detection);

        await traiterResa(a.id, { statut: 'rejetee', motif_rejet: 'Non' }); // une demande en sort
        const reduit = await conflits();
        expect(reduit).toHaveLength(1);
        expect(reduit[0].id).toBe(avant[0].id);
        expect(reduit[0].statut).toBe('ouvert');
        expect(reduit[0].reservations).toHaveLength(2);
        expect(reduit[0].description).toMatch(/2 demandes en concurrence/);
    });

    test('une réservation et un déplacement ponctuel visant la même place → conflit mixte', async () => {
        const s = await creerSeance();
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].type_conflit).toBe('salle');
        expect(liste[0].reservations.map((x) => x.id)).toEqual([r.id]);
        expect(liste[0].demandes.map((x) => x.id)).toEqual([d.id]);
        expect(liste[0].demandes[0]).toMatchObject({
            type_demande: 'deplacement_ponctuel', statut: 'en_attente', enseignant_nom: 'Alami',
            nom_module: 'Algorithmique', salle_actuelle: 'Salle A', nouvelle_salle: 'Amphi A',
        });
    });

    test('deux déplacements ponctuels vers la même place → conflit entre deux demandes', async () => {
        const s1 = await creerSeance();
        const s2 = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] });
        const d1 = await creerDemande(ens1Token, ponctuel(s1, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        const d2 = await creerDemande(ens2Token, ponctuel(s2, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].reservations).toEqual([]);
        expect(liste[0].demandes.map((x) => x.id)).toEqual([d1.id, d2.id]);
    });

    test('un déplacement définitif et une réservation sur un mardi de la période → conflit', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, definitif(s, { nouveau_creneau_id: ids.mar8 }));
        const r = await creerResa(ens2Token, { groupe_id: ids.g2 }); // Salle A, mardi 15 déc.
        const liste = await conflits();
        expect(liste).toHaveLength(1);
        expect(liste[0].demandes.map((x) => x.id)).toEqual([d.id]);
        expect(liste[0].reservations.map((x) => x.id)).toEqual([r.id]);
    });

    test('une annulation n’occupe rien → aucun conflit', async () => {
        const s = await creerSeance();
        await creerDemande(ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14' });
        await creerResa(ens2Token, { groupe_id: ids.g2 });
        expect(await conflits()).toEqual([]);
    });

    test('deux demandes d’une même séance ne se disputent rien', async () => {
        const s = await creerSeance();
        await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215 }));
        await creerDemande(ens1Token, definitif(s, { nouveau_creneau_id: ids.mar8 }));
        expect(await conflits()).toEqual([]);
    });

    test('consulter deux fois ne crée pas de doublon', async () => {
        await deuxResasEnConcurrence();
        await conflits();
        await conflits();
        expect(await conflits()).toHaveLength(1);
        expect(Number((await pool.query('SELECT COUNT(*) FROM conflit')).rows[0].count)).toBe(1);
    });
});

// ============================================================
describe('Conflits - demandes bloquées par une place déjà prise (modification de l’admin)', () => {
    test('l’admin pose une séance sur une place visée par 2 réservations en attente', async () => {
        const [r1, r2] = await deuxResasEnConcurrence();
        const res = await ajouterSeance({ creneau_id: ids.mar8 }); // Salle A, mardi 8h-10h

        // 1. la modification de l'admin est appliquée, et il est informé des demandes touchées
        expect(res.status).toBe(201);
        expect(res.body.demandes_en_conflit).toEqual(expect.arrayContaining([
            { type: 'reservation', id: r1.id, enseignant_id: ids.ens1 },
            { type: 'reservation', id: r2.id, enseignant_id: ids.ens2 },
        ]));
        expect(res.body.demandes_en_conflit).toHaveLength(2);

        // 2. le conflit existant est désormais « bloqué par un cours » (un seul conflit, pas de doublon)
        const liste = await conflits('?statut=ouvert');
        expect(liste).toHaveLength(1);
        expect(liste[0].description).toMatch(/demandes bloquées par un cours \(EDT\)/);
        expect(liste[0].reservations.map((r) => r.id)).toEqual([r1.id, r2.id]);

        // 3. ces demandes ne peuvent plus être confirmées
        const c = await traiterResa(r1.id, { statut: 'confirmee' });
        expect(c.status).toBe(409);
        expect(c.body.message).toMatch(/Impossible de confirmer.*cours/);
        expect((await statutResa(r1.id)).statut).toBe('en_attente');
    });

    test('supprimer la séance fait redevenir le conflit une simple concurrence', async () => {
        await deuxResasEnConcurrence();
        const s = await creerSeance({ creneau_id: ids.mar8 });
        await api('delete', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken);
        const liste = await conflits('?statut=ouvert');
        expect(liste).toHaveLength(1);
        expect(liste[0].description).toMatch(/2 demandes en concurrence/);
    });

    test('une demande de changement bloquée par une nouvelle séance → conflit « demande bloquée »', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, ponctuel(s, { nouvelle_salle_id: ids.salleB }));
        const x = await ajouterSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] });
        expect(x.status).toBe(201);
        expect(x.body.demandes_en_conflit).toEqual([{ type: 'demande_changement', id: d.id, enseignant_id: ids.ens1 }]);

        const liste = await conflits('?statut=ouvert');
        expect(liste).toHaveLength(1);
        expect(liste[0].type_conflit).toBe('salle');
        expect(liste[0].demandes.map((y) => y.id)).toEqual([d.id]);
        expect(liste[0].description).toMatch(/demande bloquée par un cours/);
    });

    test('modifier une séance (PUT) vers une place visée par une demande → l’admin est informé', async () => {
        const y = await creerSeance({ salle_id: ids.salleB, creneau_id: ids.jeu8 });
        const r = await creerResa(ens2Token, { groupe_id: ids.g2 }); // Salle A, mardi 15 déc.
        const res = await api('put', `/api/edts/${ids.s1}/seances/${y.id}`, adminToken, corpsSeance({ creneau_id: ids.mar8 }));
        expect(res.status).toBe(200);
        expect(res.body.demandes_en_conflit).toEqual([{ type: 'reservation', id: r.id, enseignant_id: ids.ens2 }]);
        expect(await conflits('?statut=ouvert')).toHaveLength(1);
    });

    test('une séance qui ne touche aucune demande → liste vide', async () => {
        await creerResa(ens1Token);
        const res = await ajouterSeance({ salle_id: ids.salleB, creneau_id: ids.jeu8, groupe_ids: [ids.g2], enseignant_id: ids.ens2 });
        expect(res.status).toBe(201);
        expect(res.body.demandes_en_conflit).toEqual([]);
    });
});

// ============================================================
describe('Conflits - vie d’un conflit', () => {
    test('rejeter une des demandes résout le conflit (et ne refuse personne d’autre)', async () => {
        const [r1, r2] = await deuxResasEnConcurrence();
        const rej = await traiterResa(r1.id, { statut: 'rejetee', motif_rejet: 'Non' });
        expect(rej.status).toBe(200);
        expect(rej.body.refusees).toEqual([]);
        expect((await statutResa(r2.id)).statut).toBe('en_attente');

        expect(await conflits('?statut=ouvert')).toEqual([]);
        const resolus = await conflits('?statut=resolu');
        expect(resolus).toHaveLength(1);
        expect(resolus[0].reservations.map((r) => r.statut).sort()).toEqual(['en_attente', 'rejetee']);
    });

    test('l’enseignant qui annule sa demande résout le conflit', async () => {
        const [r1] = await deuxResasEnConcurrence();
        expect((await api('put', `/api/reservations/${r1.id}/annuler`, ens1Token)).status).toBe(200);
        expect(await conflits('?statut=ouvert')).toEqual([]);
        expect(await conflits('?statut=resolu')).toHaveLength(1);
    });

    test('un conflit peut réapparaître après avoir été résolu (nouvelle ligne, l’ancienne reste en historique)', async () => {
        const [r1] = await deuxResasEnConcurrence();
        await traiterResa(r1.id, { statut: 'rejetee', motif_rejet: 'Non' });
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        expect(await conflits('?statut=ouvert')).toHaveLength(1);
        expect(await conflits('?statut=resolu')).toHaveLength(1);
    });

    test('supprimer la séance d’une demande en conflit résout le conflit sans erreur', async () => {
        const s = await creerSeance();
        await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        expect(await conflits('?statut=ouvert')).toHaveLength(1);

        const del = await api('delete', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken);
        expect(del.status).toBe(200);
        expect(await conflits('?statut=ouvert')).toEqual([]);
        expect(await conflits('?statut=resolu')).toHaveLength(1);
    });

    test('supprimer l’EDT d’une demande en conflit fonctionne aussi', async () => {
        const s = await creerSeance();
        await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        expect((await api('delete', `/api/edts/${ids.s1}`, adminToken)).status).toBe(200);
        expect(await conflits('?statut=ouvert')).toEqual([]);
    });

    test('le filtre par statut sépare conflits ouverts et résolus', async () => {
        const [r1] = await deuxResasEnConcurrence();
        const dix = await nouveauCreneau('2026-12-14', 'lundi', '10:00', '12:00');
        await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1216 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1216 });
        await traiterResa(r1.id, { statut: 'rejetee', motif_rejet: 'Non' });
        expect(await conflits('?statut=ouvert')).toHaveLength(1);
        expect(await conflits('?statut=resolu')).toHaveLength(1);
        expect(await conflits()).toHaveLength(2);
        expect(dix).toBeTruthy();
    });
});

// ============================================================
describe('Situation 1 - accepter une demande refuse automatiquement les concurrentes', () => {
    test('confirmer une réservation refuse celle qui visait la même place', async () => {
        const [r1, r2] = await deuxResasEnConcurrence();
        const res = await traiterResa(r1.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r2.id }]);

        const refusee = await statutResa(r2.id);
        expect(refusee.statut).toBe('rejetee');
        expect(refusee.motif_rejet).toMatch(/^Conflit : la place a été attribuée à la réservation n°/);
        expect(refusee.admin_id).toBe(ids.admin);
        expect(refusee.date_traitement).not.toBeNull();
        expect(await conflits('?statut=ouvert')).toEqual([]);
    });

    test('confirmer refuse aussi la demande qui ne partage QUE le groupe (autre salle, autre enseignant)', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1, salle_id: ids.salleA });
        const r2 = await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.salleB });
        const res = await traiterResa(r1.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r2.id }]);
        expect((await statutResa(r2.id)).statut).toBe('rejetee');
    });

    test('confirmer refuse aussi la demande qui ne partage QUE l’enseignant (autre salle, autre groupe)', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1, salle_id: ids.salleA });
        const r2 = await creerResa(ens1Token, { groupe_id: ids.g2, salle_id: ids.salleB });
        const res = await traiterResa(r1.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r2.id }]);
    });

    test('un groupe concerné par 3 demandes au même moment : confirmer l’une refuse les deux autres', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1, salle_id: ids.salleA });
        const r2 = await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.salleB });
        const r3 = await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.amphi });
        const res = await traiterResa(r2.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toHaveLength(2);
        expect(res.body.refusees).toEqual(expect.arrayContaining([
            { type: 'reservation', id: r1.id }, { type: 'reservation', id: r3.id },
        ]));
    });

    test('une séance à plusieurs groupes : accepter son déplacement refuse la réservation d’un seul de ces groupes', async () => {
        const s = await creerSeance({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g2] });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.pile }));
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.salleB });
        const res = await traiterDemande(d.id, { statut: 'acceptee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r.id }]);
    });

    test('confirmer une réservation refuse un déplacement ponctuel concurrent', async () => {
        const s = await creerSeance();
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));

        const res = await traiterResa(r.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'demande_changement', id: d.id }]);
        const refusee = await statutDemande(d.id);
        expect(refusee.statut).toBe('refusee');
        expect(refusee.motif_refus).toMatch(/Conflit/);
        expect(refusee.admin_id).toBe(ids.admin);
    });

    test('accepter un déplacement ponctuel refuse la réservation concurrente', async () => {
        const s = await creerSeance();
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));

        const res = await traiterDemande(d.id, { statut: 'acceptee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r.id }]);
        expect((await statutResa(r.id)).statut).toBe('rejetee');
        expect((await statutResa(r.id)).motif_rejet).toMatch(/demande de changement n°/);
    });

    test('accepter un déplacement définitif refuse la réservation concurrente et modifie la séance', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, definitif(s, { nouveau_creneau_id: ids.mar8 }));
        const r = await creerResa(ens2Token, { groupe_id: ids.g2 }); // Salle A, mardi 15 déc.

        const res = await traiterDemande(d.id, { statut: 'acceptee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r.id }]);
        expect((await seanceEnBase(s.id)).creneau_id).toBe(ids.mar8);
        expect((await statutResa(r.id)).statut).toBe('rejetee');
    });

    test('accepter une annulation ne refuse personne', async () => {
        const s = await creerSeance();
        await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.salleB });
        const d = await creerDemande(ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14' });
        const res = await traiterDemande(d.id, { statut: 'acceptee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([]);
    });

    test('accepter une annulation libère la place : la demande qui était bloquée par le cours devient confirmable', async () => {
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214 }); // lundi 14 déc., Salle A
        const s = await creerSeance(); // l'admin pose ensuite un cours lundi 8h Salle A : la réservation est bloquée
        expect((await traiterResa(r.id, { statut: 'confirmee' })).status).toBe(409);

        const d = await creerDemande(ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14' });
        const acc = await traiterDemande(d.id, { statut: 'acceptee' });
        expect(acc.status).toBe(200);
        expect(acc.body.refusees).toEqual([]);           // la demande bloquée n'est PAS refusée
        expect((await statutResa(r.id)).statut).toBe('en_attente');

        const conf = await traiterResa(r.id, { statut: 'confirmee' }); // et elle peut maintenant être confirmée
        expect(conf.status).toBe(200);
    });

    test('refuser une demande n’en refuse aucune autre', async () => {
        const s1 = await creerSeance();
        const s2 = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] });
        const d1 = await creerDemande(ens1Token, ponctuel(s1, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        const d2 = await creerDemande(ens2Token, ponctuel(s2, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        const res = await traiterDemande(d1.id, { statut: 'refusee', motif_refus: 'Non' });
        expect(res.body.refusees).toEqual([]);
        expect((await statutDemande(d2.id)).statut).toBe('en_attente');
    });

    test('seules les demandes qui chevauchent la place acceptée sont refusées (chaîne A-B-C)', async () => {
        const dix = await nouveauCreneau('2026-12-14', 'lundi', '10:00', '12:00');
        const a = await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        const b = await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214b });
        const c = await creerResa(ens1Token, { groupe_id: ids.g3, creneau_id: dix });

        const res = await traiterResa(a.id, { statut: 'confirmee' });
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: b.id }]);
        expect((await statutResa(c.id)).statut).toBe('en_attente'); // C ne chevauche pas A
        expect(await conflits('?statut=ouvert')).toEqual([]);
    });

    test('confirmer la demande du milieu (B) refuse A et C', async () => {
        const dix = await nouveauCreneau('2026-12-14', 'lundi', '10:00', '12:00');
        const a = await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        const b = await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214b });
        const c = await creerResa(ens1Token, { groupe_id: ids.g3, creneau_id: dix });

        const res = await traiterResa(b.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toHaveLength(2);
        expect(res.body.refusees).toEqual(expect.arrayContaining([
            { type: 'reservation', id: a.id }, { type: 'reservation', id: c.id },
        ]));
    });

    test('une demande sans concurrente est confirmée sans rien refuser', async () => {
        const r = await creerResa(ens1Token);
        const res = await traiterResa(r.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([]);
    });

    test('si l’acceptation échoue (409), les demandes concurrentes ne sont pas touchées', async () => {
        const s = await creerSeance();
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        await ajouterSeance({ enseignant_id: ids.ens2, salle_id: ids.amphi, creneau_id: ids.mar8, groupe_ids: [ids.g2] }); // prend l'Amphi

        const res = await traiterDemande(d.id, { statut: 'acceptee' });
        expect(res.status).toBe(409);
        expect((await statutDemande(d.id)).statut).toBe('en_attente');
        expect((await statutResa(r.id)).statut).toBe('en_attente');
    });
});

// ============================================================
describe('Situation 2 - l’admin réaffecte une réservation (validée et confirmée directement)', () => {
    test('déplacer l’une des deux réservations dans une autre salle, puis confirmer l’autre', async () => {
        const [r1, r2] = await deuxResasEnConcurrence();

        const res = await reaffecterResa(r2.id, { salle_id: ids.salleB });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/réaffectée et confirmée/);
        expect(res.body.refusees).toEqual([]);
        expect(res.body.reservation).toMatchObject({
            statut: 'confirmee', salle_id: ids.salleB, creneau_id: ids.d1215,
            enseignant_id: ids.ens2, groupe_id: ids.g2, admin_id: ids.admin,
        });
        expect(res.body.reservation.date_traitement).not.toBeNull();

        expect(await conflits('?statut=ouvert')).toEqual([]);
        const c = await traiterResa(r1.id, { statut: 'confirmee' });
        expect(c.status).toBe(200);
        expect(c.body.refusees).toEqual([]);
    });

    test('proposer un autre créneau', async () => {
        const [, r2] = await deuxResasEnConcurrence();
        const res = await reaffecterResa(r2.id, { creneau_id: ids.d1216 });
        expect(res.status).toBe(200);
        expect(res.body.reservation).toMatchObject({ statut: 'confirmee', salle_id: ids.salleA, creneau_id: ids.d1216 });
    });

    test('la réservation réaffectée apparaît chez l’enseignant avec sa nouvelle salle', async () => {
        const [, r2] = await deuxResasEnConcurrence();
        await reaffecterResa(r2.id, { salle_id: ids.salleB });
        const liste = (await api('get', '/api/reservations', ens2Token)).body;
        expect(liste[0]).toMatchObject({ id: r2.id, statut: 'confirmee', nom_salle: 'Salle B' });
    });

    test('la nouvelle place refuse à son tour les demandes qui la visaient', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1, salle_id: ids.salleB, creneau_id: ids.d1215 });
        const r2 = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.salleA, creneau_id: ids.d1216 });
        const res = await reaffecterResa(r2.id, { salle_id: ids.salleB, creneau_id: ids.d1215 });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r1.id }]);
        expect((await statutResa(r1.id)).statut).toBe('rejetee');
    });

    describe('validations', () => {
        let r;
        beforeEach(async () => { r = await creerResa(ens1Token); });

        test.each([
            ['aucune destination', {}, 400, /salle_id\)? et\/ou|nouvelle salle/i],
            ['salle invalide', { salle_id: 'abc' }, 400, /identifiants valides/],
            ['créneau invalide', { creneau_id: -2 }, 400, /identifiants valides/],
            ['salle inexistante', { salle_id: 9999 }, 400, /introuvable/i],
            ['créneau inexistant', { creneau_id: 9999 }, 400, /introuvable/i],
            ['créneau récurrent', { creneau_id: 0 + 0 || undefined, salle_id: undefined }, 400, null],
        ].filter(([nom]) => nom !== 'créneau récurrent'))('%s → %i', async (_n, body, status, regex) => {
            const res = await reaffecterResa(r.id, body);
            expect(res.status).toBe(status);
            expect(res.body.message).toMatch(regex);
        });

        test('créneau récurrent → 400', async () => {
            const res = await reaffecterResa(r.id, { creneau_id: ids.mar8 });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/dat[ée]/i);
        });

        test('créneau dans le passé → 409', async () => {
            const res = await reaffecterResa(r.id, { creneau_id: ids.dPasse });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/pass[ée]e/i);
        });

        test('salle en maintenance → 409', async () => {
            const res = await reaffecterResa(r.id, { salle_id: ids.maintenance });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/maintenance/i);
        });

        test('salle trop petite (30 étudiants, 20 places) → 409', async () => {
            const res = await reaffecterResa(r.id, { salle_id: ids.petite });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/capacit/i);
        });

        test('destination occupée par un cours → 409, la réservation reste en attente', async () => {
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.mar8, groupe_ids: [ids.g2] });
            const res = await reaffecterResa(r.id, { salle_id: ids.salleB });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/Réaffectation impossible.*cours/);
            expect((await statutResa(r.id)).statut).toBe('en_attente');
        });

        test('aucun changement (même salle) → 400', async () => {
            const res = await reaffecterResa(r.id, { salle_id: ids.salleA });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Aucun changement/);
        });

        test('identifiant non numérique → 400 ; inexistante → 404', async () => {
            expect((await reaffecterResa('abc', { salle_id: ids.salleB })).status).toBe(400);
            expect((await reaffecterResa(9999, { salle_id: ids.salleB })).status).toBe(404);
        });

        test('déjà traitée → 400', async () => {
            await traiterResa(r.id, { statut: 'confirmee' });
            expect((await reaffecterResa(r.id, { salle_id: ids.salleB })).status).toBe(400);
        });
    });
});

// ============================================================
describe('Situation 2 - l’admin réaffecte une demande de changement', () => {
    test('déplacer l’une des deux demandes concurrentes ailleurs, puis accepter l’autre', async () => {
        const s1 = await creerSeance();
        const s2 = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] });
        const d1 = await creerDemande(ens1Token, ponctuel(s1, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        const d2 = await creerDemande(ens2Token, ponctuel(s2, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        expect(await conflits('?statut=ouvert')).toHaveLength(1);

        const res = await reaffecterDemande(d2.id, { nouvelle_salle_id: ids.pile });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/réaffectée et acceptée/);
        expect(res.body.refusees).toEqual([]);
        expect(res.body.demande).toMatchObject({
            statut: 'acceptee', nouvelle_salle_id: ids.pile, nouveau_creneau_id: ids.d1215, admin_id: ids.admin,
        });

        expect(await conflits('?statut=ouvert')).toEqual([]);
        expect((await traiterDemande(d1.id, { statut: 'acceptee' })).status).toBe(200);
    });

    test('déplacement définitif réaffecté : la séance est modifiée avec la nouvelle destination', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, definitif(s, { nouveau_creneau_id: ids.mar8 }));
        const r = await creerResa(ens2Token, { groupe_id: ids.g2 }); // se dispute le mardi avec la demande
        expect(await conflits('?statut=ouvert')).toHaveLength(1);

        const res = await reaffecterDemande(d.id, { nouveau_creneau_id: ids.jeu8 });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([]);
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.jeu8, salle_id: ids.salleA });
        expect(await conflits('?statut=ouvert')).toEqual([]);
        expect((await traiterResa(r.id, { statut: 'confirmee' })).status).toBe(200);
    });

    test('la nouvelle destination refuse à son tour les demandes concurrentes', async () => {
        const s1 = await creerSeance();
        const s2 = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] });
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.pile, creneau_id: ids.d1216 });
        const d = await creerDemande(ens1Token, ponctuel(s1, { nouvelle_salle_id: ids.amphi, nouveau_creneau_id: ids.d1215 }));
        const res = await reaffecterDemande(d.id, { nouvelle_salle_id: ids.pile, nouveau_creneau_id: ids.d1216 });
        expect(res.status).toBe(200);
        expect(res.body.refusees).toEqual([{ type: 'reservation', id: r.id }]);
        expect(s2).toBeTruthy();
    });

    describe('validations', () => {
        let s, d;
        beforeEach(async () => {
            s = await creerSeance();
            d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        });

        test('aucune destination → 400', async () => {
            expect((await reaffecterDemande(d.id, {})).status).toBe(400);
        });

        test('identifiant non numérique → 400 ; inexistante → 404', async () => {
            expect((await reaffecterDemande('abc', { nouvelle_salle_id: ids.pile })).status).toBe(400);
            expect((await reaffecterDemande(9999, { nouvelle_salle_id: ids.pile })).status).toBe(404);
        });

        test('déjà traitée → 400', async () => {
            await traiterDemande(d.id, { statut: 'refusee', motif_refus: 'Non' });
            expect((await reaffecterDemande(d.id, { nouvelle_salle_id: ids.pile })).status).toBe(400);
        });

        test('une annulation n’a pas de destination → 400', async () => {
            const a = await creerDemande(ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-07' });
            const res = await reaffecterDemande(a.id, { nouvelle_salle_id: ids.pile });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/annulation/i);
        });

        test('aucun changement → 400', async () => {
            const res = await reaffecterDemande(d.id, { nouvelle_salle_id: ids.amphi });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Aucun changement/);
        });

        test('nouveau créneau récurrent pour un déplacement ponctuel → 400', async () => {
            const res = await reaffecterDemande(d.id, { nouveau_creneau_id: ids.mar8 });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Réaffectation impossible/);
        });

        test('créneau daté pour un déplacement définitif → 400', async () => {
            const def = await creerDemande(ens1Token, definitif(s, { nouvelle_salle_id: ids.salleB }));
            const res = await reaffecterDemande(def.id, { nouveau_creneau_id: ids.d1215 });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/type/i);
        });

        test('destination occupée par un cours → 409, la demande reste en attente', async () => {
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.mar8, groupe_ids: [ids.g2] });
            const res = await reaffecterDemande(d.id, { nouvelle_salle_id: ids.salleB });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/Réaffectation impossible.*salle/i);
            expect((await statutDemande(d.id)).statut).toBe('en_attente');
        });

        test('salle en maintenance → 409', async () => {
            const res = await reaffecterDemande(d.id, { nouvelle_salle_id: ids.maintenance });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/maintenance/i);
        });
    });
});

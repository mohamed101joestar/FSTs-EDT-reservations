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
const demander = (body, t = ens1Token) => request(app).post('/api/demandes-changement').set(auth(t)).send(body);
const traiter = (id, body, t = adminToken) => request(app).put(`/api/demandes-changement/${id}/traiter`).set(auth(t)).send(body);
const lister = (t = adminToken, qs = '') => request(app).get(`/api/demandes-changement${qs}`).set(auth(t));

// Séance de ens1 : lundi 8h-10h (récurrent), Salle A, groupe G1, EDT S1 (1er sept. → 20 déc.)
const creerSeance = async (o = {}, edtId = ids.s1) => {
    const res = await request(app).post(`/api/edts/${edtId}/seances`).set(auth(adminToken)).send({
        enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
        creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1], ...o,
    });
    expect(res.status).toBe(201);
    return res.body.seance;
};

const annulation = (s, o = {}) => ({ type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14', motif: 'Congrès', ...o });
const depPonctuel = (s, o = {}) => ({ type_demande: 'deplacement_ponctuel', seance_id: s.id, date_occurrence: '2026-12-14', nouvelle_salle_id: ids.salleB, ...o });
const depDefinitif = (s, o = {}) => ({ type_demande: 'deplacement_definitif', seance_id: s.id, nouveau_creneau_id: ids.mar8, ...o });

const creer = async (body, t = ens1Token) => {
    const res = await demander(body, t);
    expect(res.status).toBe(201);
    return res.body.demande;
};
const accepter = async (id) => {
    const res = await traiter(id, { statut: 'acceptee' });
    expect(res.status).toBe(200);
    return res.body.demande;
};

// Réservation confirmée (par défaut : ens2, Salle A, lundi 14 déc., groupe G2)
const reservationConfirmee = async (o = {}) => {
    const r = await request(app).post('/api/reservations').set(auth(ens2Token)).send({
        salle_id: ids.salleA, creneau_id: ids.d1214, groupe_id: ids.g2, evenement_id: ids.cours, ...o,
    });
    expect(r.status).toBe(201);
    const c = await request(app).put(`/api/reservations/${r.body.reservation.id}/traiter`).set(auth(adminToken)).send({ statut: 'confirmee' });
    expect(c.status).toBe(200);
};
const demanderReservation = (o = {}, t = ens2Token) => request(app).post('/api/reservations').set(auth(t)).send({
    salle_id: ids.salleA, creneau_id: ids.d1214, groupe_id: ids.g2, evenement_id: ids.cours, ...o,
});

const compter = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count);
const seanceEnBase = async (id) => (await pool.query('SELECT * FROM seance WHERE id = $1', [id])).rows[0];

// ============================================================
describe('Demandes - création : droits et formulaire', () => {
    test('sans token → 401', async () => {
        const s = await creerSeance();
        const res = await request(app).post('/api/demandes-changement').send(annulation(s));
        expect(res.status).toBe(401);
    });

    test('un admin ne peut pas créer une demande → 403', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s), adminToken);
        expect(res.status).toBe(403);
    });

    test('un enseignant ne peut pas demander pour la séance d’un autre → 403', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s), ens2Token);
        expect(res.status).toBe(403);
        expect(await compter('demande_changement')).toBe(0);
    });

    test('séance inexistante → 404', async () => {
        const res = await demander({ type_demande: 'annulation_ponctuelle', seance_id: 9999, date_occurrence: '2026-12-14' });
        expect(res.status).toBe(404);
    });

    test.each([
        ['type absent', undefined],
        ['type inconnu', 'suppression'],
    ])('%s → 400', async (_n, type) => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { type_demande: type }));
        expect(res.status).toBe(400);
    });

    test.each([['abc'], [0], [-3], [1.5], [undefined]])('seance_id invalide (%p) → 400', async (v) => {
        const res = await demander({ type_demande: 'annulation_ponctuelle', seance_id: v, date_occurrence: '2026-12-14' });
        expect(res.status).toBe(400);
    });

    test('seance_id envoyé en texte → accepté', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { seance_id: String(s.id) }));
        expect(res.status).toBe(201);
    });
});

// ============================================================
describe('Demandes - annulation ponctuelle', () => {
    test('valide → 201, en attente, rattachée à l’enseignant du token', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s));
        expect(res.status).toBe(201);
        expect(res.body.demande).toMatchObject({
            type_demande: 'annulation_ponctuelle', statut: 'en_attente', seance_id: s.id,
            enseignant_id: ids.ens1, date_occurrence: '2026-12-14', motif: 'Congrès',
            nouveau_creneau_id: null, nouvelle_salle_id: null, admin_id: null, motif_refus: null,
        });
    });

    test('une destination envoyée par erreur est ignorée', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { nouvelle_salle_id: ids.salleB, nouveau_creneau_id: ids.mar8 }));
        expect(res.status).toBe(201);
        expect(res.body.demande.nouvelle_salle_id).toBeNull();
        expect(res.body.demande.nouveau_creneau_id).toBeNull();
    });

    test.each([
        ['absente', undefined],
        ['texte', 'abc'],
        ['jour inexistant', '2026-02-30'],
        ['mauvais format', '14/12/2026'],
        ['un nombre', 20261214],
    ])('date_occurrence %s → 400', async (_n, date) => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { date_occurrence: date }));
        expect(res.status).toBe(400);
    });

    test('date dans le passé (lundi 16 nov.) → 400', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { date_occurrence: '2026-11-16' }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/pass[ée]/i);
    });

    test('date qui n’est pas un lundi (mardi 15 déc.) → 400', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { date_occurrence: '2026-12-15' }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/jour de cours/i);
    });

    test('lundi après la fin de l’EDT (21 déc.) → 400', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { date_occurrence: '2026-12-21' }));
        expect(res.status).toBe(400);
    });

    test('motif facultatif : absent ou blanc → enregistré à null', async () => {
        const s = await creerSeance();
        const a = await demander(annulation(s, { motif: undefined, date_occurrence: '2026-12-07' }));
        const b = await demander(annulation(s, { motif: '   ', date_occurrence: '2026-12-14' }));
        expect(a.status).toBe(201);
        expect(a.body.demande.motif).toBeNull();
        expect(b.status).toBe(201);
        expect(b.body.demande.motif).toBeNull();
    });

    test('motif trop long (256 caractères) → 400', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { motif: 'x'.repeat(256) }));
        expect(res.status).toBe(400);
    });

    test('motif qui n’est pas un texte → 400', async () => {
        const s = await creerSeance();
        const res = await demander(annulation(s, { motif: 123 }));
        expect(res.status).toBe(400);
    });

    test('séance datée : seule sa date est valide', async () => {
        const s = await creerSeance({ creneau_id: ids.d1214 });
        const ok = await demander(annulation(s, { date_occurrence: '2026-12-14' }));
        const ko = await demander(annulation(s, { date_occurrence: '2026-12-07' }));
        expect(ok.status).toBe(201);
        expect(ko.status).toBe(400);
    });

    describe('doublons', () => {
        test('même occurrence demandée deux fois → 409', async () => {
            const s = await creerSeance();
            await creer(annulation(s));
            const res = await demander(annulation(s));
            expect(res.status).toBe(409);
        });

        test('annulation puis déplacement de la même occurrence → 409', async () => {
            const s = await creerSeance();
            await creer(annulation(s));
            const res = await demander(depPonctuel(s));
            expect(res.status).toBe(409);
        });

        test('une autre date reste possible → 201', async () => {
            const s = await creerSeance();
            await creer(annulation(s));
            const res = await demander(annulation(s, { date_occurrence: '2026-12-07' }));
            expect(res.status).toBe(201);
        });

        test('après un refus, on peut redemander → 201', async () => {
            const s = await creerSeance();
            const d = await creer(annulation(s));
            expect((await traiter(d.id, { statut: 'refusee', motif_refus: 'Non' })).status).toBe(200);
            const res = await demander(annulation(s));
            expect(res.status).toBe(201);
        });

        test('après une acceptation → 409', async () => {
            const s = await creerSeance();
            const d = await creer(annulation(s));
            await accepter(d.id);
            const res = await demander(annulation(s));
            expect(res.status).toBe(409);
        });
    });
});

// ============================================================
describe('Demandes - déplacement ponctuel', () => {
    test('nouvelle salle seule → 201 (même date, même heure)', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s));
        expect(res.status).toBe(201);
        expect(res.body.demande).toMatchObject({
            type_demande: 'deplacement_ponctuel', nouvelle_salle_id: ids.salleB, nouveau_creneau_id: null,
            date_occurrence: '2026-12-14',
        });
    });

    test('nouveau créneau daté seul → 201', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }));
        expect(res.status).toBe(201);
    });

    test('nouveau créneau + nouvelle salle → 201', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouveau_creneau_id: ids.d1215 }));
        expect(res.status).toBe(201);
    });

    test('ni créneau ni salle → 400', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined }));
        expect(res.status).toBe(400);
    });

    test('nouveau créneau récurrent → 400', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.mar8 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/dat[ée]/i);
    });

    test.each([
        ['créneau inexistant', { nouveau_creneau_id: 9999, nouvelle_salle_id: undefined }],
        ['salle inexistante', { nouvelle_salle_id: 9999 }],
        ['créneau invalide', { nouveau_creneau_id: 'abc', nouvelle_salle_id: undefined }],
        ['salle invalide', { nouvelle_salle_id: 'abc' }],
    ])('%s → 400', async (_n, o) => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, o));
        expect(res.status).toBe(400);
    });

    test('nouvelle date hors de la période de l’EDT → 400', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.dHors }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/p[ée]riode/i);
    });

    test('nouvelle date dans le passé → 400', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.dPasse }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/pass[ée]/i);
    });

    test('même salle que l’actuelle, rien d’autre → 400 (identique)', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: ids.salleA }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/identique/i);
    });

    test('même date et même heure, sans changer de salle → 400 (identique)', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1214 }));
        expect(res.status).toBe(400);
    });

    test('salle en maintenance → 409', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: ids.maintenance }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/maintenance/i);
    });

    test('salle trop petite (30 étudiants, 20 places) → 400', async () => {
        const s = await creerSeance();
        const res = await demander(depPonctuel(s, { nouvelle_salle_id: ids.petite }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/capacit/i);
    });

    describe('protection des séances et des réservations', () => {
        test('nouvelle salle occupée par un autre cours à ce moment → 409', async () => {
            const s = await creerSeance();
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] }); // lundi 8h Salle B
            const res = await demander(depPonctuel(s));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/salle/i);
        });

        test('enseignant déjà occupé au nouveau créneau → 409', async () => {
            const s = await creerSeance();
            await creerSeance({ salle_id: ids.salleB, creneau_id: ids.mar8, groupe_ids: [ids.g2] }); // ens1 mardi 8h
            const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/enseignant/i);
        });

        test('groupe déjà occupé au nouveau créneau → 409', async () => {
            const s = await creerSeance();
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.mar8 }); // G1 mardi 8h
            const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/groupe/i);
        });

        test('salle réservée (réservation confirmée) au nouveau créneau → 409', async () => {
            const s = await creerSeance();
            await reservationConfirmee({ creneau_id: ids.d1215 });
            const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/r[ée]servation/i);
        });

        test('une réservation seulement en attente ne bloque pas → 201', async () => {
            const s = await creerSeance();
            expect((await demanderReservation({ creneau_id: ids.d1215 })).status).toBe(201);
            const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }));
            expect(res.status).toBe(201);
        });

        test('déplacer vers une autre occurrence de la même séance → 409 (elle serait en conflit avec elle-même)', async () => {
            const s = await creerSeance();
            const res = await demander(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1207 }));
            expect(res.status).toBe(409);
        });
    });
});

// ============================================================
describe('Demandes - déplacement définitif', () => {
    test('nouveau créneau récurrent → 201, sans date d’occurrence', async () => {
        const s = await creerSeance();
        const res = await demander(depDefinitif(s, { date_occurrence: '2026-12-14' }));
        expect(res.status).toBe(201);
        expect(res.body.demande).toMatchObject({
            type_demande: 'deplacement_definitif', nouveau_creneau_id: ids.mar8, nouvelle_salle_id: null, date_occurrence: null,
        });
    });

    test('nouvelle salle seule → 201', async () => {
        const s = await creerSeance();
        const res = await demander(depDefinitif(s, { nouveau_creneau_id: undefined, nouvelle_salle_id: ids.salleB }));
        expect(res.status).toBe(201);
    });

    test('ni créneau ni salle → 400', async () => {
        const s = await creerSeance();
        const res = await demander(depDefinitif(s, { nouveau_creneau_id: undefined }));
        expect(res.status).toBe(400);
    });

    test('créneau daté pour une séance récurrente → 400 (type différent)', async () => {
        const s = await creerSeance();
        const res = await demander(depDefinitif(s, { nouveau_creneau_id: ids.d1215 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/type/i);
    });

    test('créneau récurrent pour une séance datée → 400 (type différent)', async () => {
        const s = await creerSeance({ creneau_id: ids.d1214 });
        const res = await demander(depDefinitif(s));
        expect(res.status).toBe(400);
    });

    test('séance datée vers une autre date → 201', async () => {
        const s = await creerSeance({ creneau_id: ids.d1214 });
        const res = await demander(depDefinitif(s, { nouveau_creneau_id: ids.d1207 }));
        expect(res.status).toBe(201);
    });

    test('même créneau que l’actuel → 400 (identique)', async () => {
        const s = await creerSeance();
        const res = await demander(depDefinitif(s, { nouveau_creneau_id: ids.lun8 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/identique/i);
    });

    test('même salle que l’actuelle → 400 (identique)', async () => {
        const s = await creerSeance();
        const res = await demander(depDefinitif(s, { nouveau_creneau_id: undefined, nouvelle_salle_id: ids.salleA }));
        expect(res.status).toBe(400);
    });

    test('créneau ou salle inexistants → 400', async () => {
        const s = await creerSeance();
        expect((await demander(depDefinitif(s, { nouveau_creneau_id: 9999 }))).status).toBe(400);
        expect((await demander(depDefinitif(s, { nouveau_creneau_id: undefined, nouvelle_salle_id: 9999 }))).status).toBe(400);
    });

    test('salle en maintenance → 409 ; salle trop petite → 400', async () => {
        const s = await creerSeance();
        const a = await demander(depDefinitif(s, { nouveau_creneau_id: undefined, nouvelle_salle_id: ids.maintenance }));
        const b = await demander(depDefinitif(s, { nouveau_creneau_id: undefined, nouvelle_salle_id: ids.petite }));
        expect(a.status).toBe(409);
        expect(b.status).toBe(400);
    });

    test('une seule demande définitive en attente par séance → 409 ; après refus, possible', async () => {
        const s = await creerSeance();
        const d = await creer(depDefinitif(s));
        expect((await demander(depDefinitif(s, { nouveau_creneau_id: ids.jeu8 }))).status).toBe(409);
        await traiter(d.id, { statut: 'refusee', motif_refus: 'Non' });
        expect((await demander(depDefinitif(s, { nouveau_creneau_id: ids.jeu8 }))).status).toBe(201);
    });

    test('EDT terminé → 409', async () => {
        const edt = (await pool.query(
            `INSERT INTO edt (titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id)
             VALUES ('Ancien', '2025-2026', 'S2', '2026-01-05', '2026-06-30', $1) RETURNING id`, [ids.f1])).rows[0].id;
        const s = await creerSeance({}, edt);
        const res = await demander(depDefinitif(s));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/termin/i);
    });

    test('changement ponctuel déjà accepté à venir → 409', async () => {
        const s = await creerSeance();
        await accepter((await creer(annulation(s))).id);
        const res = await demander(depDefinitif(s));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/ponctuel/i);
    });

    test('changement ponctuel accepté mais déjà passé → ne bloque pas', async () => {
        const s = await creerSeance();
        await pool.query(
            `INSERT INTO demande_changement (type_demande, date_occurrence, seance_id, enseignant_id, statut)
             VALUES ('annulation_ponctuelle', '2026-11-09', $1, $2, 'acceptee')`, [s.id, ids.ens1]);
        const res = await demander(depDefinitif(s));
        expect(res.status).toBe(201);
    });

    describe('protection des séances et des réservations', () => {
        test('salle occupée au nouveau créneau → 409', async () => {
            const s = await creerSeance();
            await creerSeance({ enseignant_id: ids.ens2, creneau_id: ids.mar8, groupe_ids: [ids.g2] }); // Salle A mardi 8h
            const res = await demander(depDefinitif(s));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/salle/i);
        });

        test('enseignant déjà occupé au nouveau créneau → 409', async () => {
            const s = await creerSeance();
            await creerSeance({ salle_id: ids.salleB, creneau_id: ids.mar8, groupe_ids: [ids.g2] }); // ens1 mardi 8h
            const res = await demander(depDefinitif(s));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/enseignant/i);
        });

        test('groupe déjà occupé au nouveau créneau → 409', async () => {
            const s = await creerSeance();
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.mar8 }); // G1 mardi 8h
            const res = await demander(depDefinitif(s));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/groupe/i);
        });

        test('un mardi de la période est réservé (réservation confirmée) → 409', async () => {
            const s = await creerSeance();
            await reservationConfirmee({ creneau_id: ids.d1215 }); // mardi 15 déc., Salle A
            const res = await demander(depDefinitif(s));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/r[ée]servation/i);
        });

        test('chevauchement partiel (lundi 9h-11h) avec un autre cours → 409', async () => {
            const s = await creerSeance({ creneau_id: ids.lun10, salle_id: ids.salleB });
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.lun8, groupe_ids: [ids.g2] }); // 8h-10h
            const res = await demander(depDefinitif(s, { nouveau_creneau_id: ids.lun9 }));
            expect(res.status).toBe(409);
        });

        test('créneaux qui se touchent (10h-12h après 8h-10h) → 201', async () => {
            const s = await creerSeance({ creneau_id: ids.mar8 });
            await creerSeance({ enseignant_id: ids.ens2, groupe_ids: [ids.g2] }); // lundi 8h-10h Salle A
            const res = await demander(depDefinitif(s, { nouveau_creneau_id: ids.lun10, nouvelle_salle_id: ids.salleA }));
            expect(res.status).toBe(201);
        });
    });
});

// ============================================================
describe('Demandes - liste', () => {
    test('sans token → 401', async () => {
        const res = await request(app).get('/api/demandes-changement');
        expect(res.status).toBe(401);
    });

    test('un enseignant ne voit que ses demandes, l’admin voit tout', async () => {
        const s1 = await creerSeance();
        const s2 = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.mar8, groupe_ids: [ids.g2] });
        await creer(annulation(s1));
        await creer(annulation(s2, { date_occurrence: '2026-12-15' }), ens2Token);

        const ens = await lister(ens1Token);
        expect(ens.body).toHaveLength(1);
        expect(ens.body[0].enseignant_id).toBe(ids.ens1);
        expect((await lister(adminToken)).body).toHaveLength(2);
    });

    test('contient le détail de la séance, de l’enseignant et de la destination', async () => {
        const s = await creerSeance();
        await creer(depPonctuel(s, { nouveau_creneau_id: ids.d1215 }));
        const res = await lister(adminToken);
        expect(res.body[0]).toMatchObject({
            type_demande: 'deplacement_ponctuel', statut: 'en_attente',
            enseignant_nom: 'Alami', nom_module: 'Algorithmique',
            salle_actuelle: 'Salle A', jour_actuel: 'lundi', heure_debut_actuelle: '08:00:00',
            nouvelle_salle: 'Salle B', nouveau_date_creneau: '2026-12-15', nouveau_jour: 'mardi',
            date_occurrence: '2026-12-14', groupes: ['G1'],
        });
    });

    test('filtre par statut et statut invalide → 400', async () => {
        const s = await creerSeance();
        const d1 = await creer(annulation(s));
        await creer(annulation(s, { date_occurrence: '2026-12-07' }));
        await traiter(d1.id, { statut: 'refusee', motif_refus: 'Non' });

        expect((await lister(adminToken, '?statut=en_attente')).body).toHaveLength(1);
        expect((await lister(adminToken, '?statut=refusee')).body).toHaveLength(1);
        expect((await lister(adminToken, '?statut=acceptee')).body).toHaveLength(0);
        expect((await lister(adminToken, '?statut=nimporte')).status).toBe(400);
    });

    test('la plus récente en premier', async () => {
        const s = await creerSeance();
        const a = await creer(annulation(s, { date_occurrence: '2026-12-07' }));
        const b = await creer(annulation(s, { date_occurrence: '2026-12-14' }));
        const res = await lister(adminToken);
        expect(res.body.map((d) => d.id)).toEqual([b.id, a.id]);
    });
});

// ============================================================
describe('Demandes - traitement par l’admin', () => {
    test('un enseignant ne peut pas traiter → 403', async () => {
        const d = await creer(annulation(await creerSeance()));
        const res = await traiter(d.id, { statut: 'acceptee' }, ens1Token);
        expect(res.status).toBe(403);
    });

    test('identifiant non numérique → 400', async () => {
        expect((await traiter('abc', { statut: 'acceptee' })).status).toBe(400);
    });

    test('demande inexistante → 404', async () => {
        expect((await traiter(9999, { statut: 'acceptee' })).status).toBe(404);
    });

    test('statut invalide ou absent → 400', async () => {
        const d = await creer(annulation(await creerSeance()));
        expect((await traiter(d.id, { statut: 'confirmee' })).status).toBe(400);
        expect((await traiter(d.id, {})).status).toBe(400);
    });

    test.each([['absent', undefined], ['blanc', '   '], ['trop long', 'x'.repeat(256)]])(
        'refus avec motif %s → 400', async (_n, motif) => {
            const d = await creer(annulation(await creerSeance()));
            const res = await traiter(d.id, { statut: 'refusee', motif_refus: motif });
            expect(res.status).toBe(400);
        });

    test('demande déjà traitée → 400', async () => {
        const d = await creer(annulation(await creerSeance()));
        await accepter(d.id);
        expect((await traiter(d.id, { statut: 'refusee', motif_refus: 'x' })).status).toBe(400);
        expect((await traiter(d.id, { statut: 'acceptee' })).status).toBe(400);
    });

    test('refus → 200, motif et admin enregistrés, séance inchangée', async () => {
        const s = await creerSeance();
        const d = await creer(depDefinitif(s));
        const res = await traiter(d.id, { statut: 'refusee', motif_refus: 'Salle indisponible' });
        expect(res.status).toBe(200);
        expect(res.body.demande).toMatchObject({ statut: 'refusee', motif_refus: 'Salle indisponible', admin_id: ids.admin });
        expect(res.body.demande.date_traitement).not.toBeNull();
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.lun8, salle_id: ids.salleA });
    });

    test('acceptation d’une annulation → 200, la séance reste en base inchangée', async () => {
        const s = await creerSeance();
        const d = await creer(annulation(s));
        const res = await traiter(d.id, { statut: 'acceptee' });
        expect(res.status).toBe(200);
        expect(res.body.demande).toMatchObject({ statut: 'acceptee', admin_id: ids.admin });
        expect(res.body.demande.date_traitement).not.toBeNull();
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.lun8, salle_id: ids.salleA });
    });

    test('acceptation d’un déplacement ponctuel → 200, la séance de base reste inchangée', async () => {
        const s = await creerSeance();
        await accepter((await creer(depPonctuel(s, { nouveau_creneau_id: ids.d1215 }))).id);
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.lun8, salle_id: ids.salleA });
    });

    test('acceptation d’un déplacement définitif (créneau) → la séance est modifiée', async () => {
        const s = await creerSeance();
        await accepter((await creer(depDefinitif(s))).id);
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.mar8, salle_id: ids.salleA });
    });

    test('acceptation d’un déplacement définitif (salle seule) → seule la salle change', async () => {
        const s = await creerSeance();
        await accepter((await creer(depDefinitif(s, { nouveau_creneau_id: undefined, nouvelle_salle_id: ids.salleB }))).id);
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.lun8, salle_id: ids.salleB });
    });

    test('acceptation d’un déplacement définitif (créneau + salle) → les deux changent', async () => {
        const s = await creerSeance();
        await accepter((await creer(depDefinitif(s, { nouvelle_salle_id: ids.salleB }))).id);
        expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.mar8, salle_id: ids.salleB });
    });

    describe('revérification à l’acceptation (le planning a pu changer)', () => {
        test('définitif : une réservation confirmée occupe entre-temps le nouveau créneau → 409, rien ne change', async () => {
            const s = await creerSeance();
            const d = await creer(depDefinitif(s));
            await reservationConfirmee({ creneau_id: ids.d1215 });

            const res = await traiter(d.id, { statut: 'acceptee' });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/Impossible d'accepter/);
            expect((await pool.query('SELECT statut FROM demande_changement WHERE id = $1', [d.id])).rows[0].statut).toBe('en_attente');
            expect(await seanceEnBase(s.id)).toMatchObject({ creneau_id: ids.lun8 });
        });

        test('ponctuel : la salle visée est prise entre-temps → 409', async () => {
            const s = await creerSeance();
            const d = await creer(depPonctuel(s));
            await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, creneau_id: ids.d1214, groupe_ids: [ids.g2] });

            const res = await traiter(d.id, { statut: 'acceptee' });
            expect(res.status).toBe(409);
            expect((await pool.query('SELECT statut FROM demande_changement WHERE id = $1', [d.id])).rows[0].statut).toBe('en_attente');
        });

        test('ponctuel : la salle visée passe en maintenance entre-temps → 409', async () => {
            const s = await creerSeance();
            const d = await creer(depPonctuel(s));
            await pool.query("UPDATE salle SET etat = 'en_maintenance' WHERE id = $1", [ids.salleB]);
            const res = await traiter(d.id, { statut: 'acceptee' });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/maintenance/i);
        });

        test('annulation : la date est passée entre-temps → 409', async () => {
            const s = await creerSeance();
            const d = await creer(annulation(s));
            jest.setSystemTime(new Date('2026-12-15T10:00:00'));
            adminToken = tokenFor({ id: ids.admin, role: 'admin' }); // le jeton précédent a "expiré" avec l'horloge
            const res = await traiter(d.id, { statut: 'acceptee' });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/pass[ée]e/i);
        });

        test('définitif : un changement ponctuel a été accepté entre-temps → 409', async () => {
            const s = await creerSeance();
            const definitif = await creer(depDefinitif(s));
            await accepter((await creer(annulation(s))).id);
            const res = await traiter(definitif.id, { statut: 'acceptee' });
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/ponctuel/i);
        });
    });
});

// ============================================================
describe('Demandes - effets sur les ressources (libération et occupation)', () => {
    describe('annulation ponctuelle acceptée', () => {
        test('avant acceptation, la salle, l’enseignant et le groupe sont bien occupés le 14 déc.', async () => {
            await creerSeance();
            expect((await demanderReservation()).status).toBe(409);                                                  // Salle A
            expect((await demanderReservation({ salle_id: ids.salleB }, ens1Token)).status).toBe(409);               // enseignant
            expect((await demanderReservation({ salle_id: ids.salleB, groupe_id: ids.g1 })).status).toBe(409);       // groupe
        });

        test('libère la salle ce jour-là, mais pas les autres lundis', async () => {
            const s = await creerSeance();
            expect((await demanderReservation()).status).toBe(409);
            await accepter((await creer(annulation(s))).id);

            expect((await demanderReservation()).status).toBe(201);                                   // 14 déc. libre
            expect((await demanderReservation({ creneau_id: ids.d1207 })).status).toBe(409);          // 7 déc. toujours pris
        });

        test('libère l’enseignant ce jour-là', async () => {
            const s = await creerSeance();
            const resa = { salle_id: ids.salleB };
            expect((await demanderReservation(resa, ens1Token)).status).toBe(409); // ens1 a cours
            await accepter((await creer(annulation(s))).id);
            expect((await demanderReservation(resa, ens1Token)).status).toBe(201);
        });

        test('libère le groupe ce jour-là', async () => {
            const s = await creerSeance();
            const resa = { salle_id: ids.salleB, groupe_id: ids.g1 };
            expect((await demanderReservation(resa)).status).toBe(409); // G1 a cours
            await accepter((await creer(annulation(s))).id);
            expect((await demanderReservation(resa)).status).toBe(201);
        });

        test('une annulation en attente ou refusée ne libère rien', async () => {
            const s = await creerSeance();
            const d = await creer(annulation(s));
            expect((await demanderReservation()).status).toBe(409);
            await traiter(d.id, { statut: 'refusee', motif_refus: 'Non' });
            expect((await demanderReservation()).status).toBe(409);
        });

        test('libère aussi la place pour une nouvelle séance (EDT) ce jour-là', async () => {
            const s = await creerSeance();
            const nouvelle = { enseignant_id: ids.ens2, creneau_id: ids.d1214, groupe_ids: [ids.g2] };
            const avant = await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({
                enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, evenement_id: ids.cours, ...nouvelle });
            expect(avant.status).toBe(409);

            await accepter((await creer(annulation(s))).id);
            const apres = await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({
                enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, evenement_id: ids.cours, ...nouvelle });
            expect(apres.status).toBe(201);
        });

        test('une séance datée annulée libère sa place', async () => {
            const s = await creerSeance({ creneau_id: ids.d1214 });
            expect((await demanderReservation()).status).toBe(409);
            await accepter((await creer(annulation(s))).id);
            expect((await demanderReservation()).status).toBe(201);
        });
    });

    describe('déplacement ponctuel accepté (nouvelle salle, même horaire)', () => {
        test('libère l’ancienne salle et occupe la nouvelle, à cette date seulement', async () => {
            const s = await creerSeance();
            await accepter((await creer(depPonctuel(s))).id); // Salle A → Salle B le 14 déc.

            expect((await demanderReservation({ salle_id: ids.salleA })).status).toBe(201);          // Salle A libre
            const prise = await demanderReservation({ salle_id: ids.salleB });                        // Salle B occupée
            expect(prise.status).toBe(409);
            expect(prise.body.message).toMatch(/d[ée]plac[ée]/i);
            expect((await demanderReservation({ salle_id: ids.salleB, creneau_id: ids.d1207 })).status).toBe(201); // 7 déc. : Salle B libre
        });

        test('l’enseignant et le groupe restent occupés (ils enseignent toujours ce jour-là)', async () => {
            const s = await creerSeance();
            await accepter((await creer(depPonctuel(s))).id);
            const ens = await demanderReservation({ salle_id: ids.amphi }, ens1Token);
            expect(ens.status).toBe(409);
            expect(ens.body.message).toMatch(/enseignant/i);
            const grp = await demanderReservation({ salle_id: ids.amphi, groupe_id: ids.g1 });
            expect(grp.status).toBe(409);
            expect(grp.body.message).toMatch(/groupe/i);
        });
    });

    describe('déplacement ponctuel accepté (nouveau créneau)', () => {
        test('libère le 14 déc. et occupe le 15 déc. (salle, enseignant, groupe)', async () => {
            const s = await creerSeance();
            await accepter((await creer(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }))).id);

            expect((await demanderReservation()).status).toBe(201); // 14 déc. Salle A libre

            const salle = await demanderReservation({ creneau_id: ids.d1215 });
            expect(salle.status).toBe(409);
            expect(salle.body.message).toMatch(/salle.*d[ée]plac[ée]/i);
            expect((await demanderReservation({ creneau_id: ids.d1215, salle_id: ids.salleB }, ens1Token)).status).toBe(409); // ens1
            expect((await demanderReservation({ creneau_id: ids.d1215, salle_id: ids.salleB, groupe_id: ids.g1 })).status).toBe(409); // G1
        });

        test('protège aussi contre l’ajout de séances (récurrente le mardi, ou datée le 15)', async () => {
            const s = await creerSeance();
            await accepter((await creer(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }))).id);
            const base = { enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, evenement_id: ids.cours, groupe_ids: [ids.g2] };

            const recurrente = await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({ ...base, creneau_id: ids.mar8 });
            expect(recurrente.status).toBe(409);
            expect(recurrente.body.message).toMatch(/d[ée]plac[ée]/i);
            const datee = await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({ ...base, creneau_id: ids.d1215 });
            expect(datee.status).toBe(409);
            const libre = await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({ ...base, creneau_id: ids.d1214 });
            expect(libre.status).toBe(201); // le 14 déc. est libéré
        });

        test('deux occurrences déplacées ne peuvent pas atterrir sur la même place', async () => {
            const s = await creerSeance();
            await accepter((await creer(depPonctuel(s, { nouvelle_salle_id: undefined, nouveau_creneau_id: ids.d1215 }))).id);
            const autre = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] }); // lundi 8h Salle B
            const res = await demander(depPonctuel(autre, { nouvelle_salle_id: ids.salleA, nouveau_creneau_id: ids.d1215 }), ens2Token);
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/salle/i);
        });

        test('une place libérée par l’annulation d’un autre cours peut être prise', async () => {
            const s = await creerSeance();
            const e = await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] }); // lundi 8h Salle B
            expect((await demander(depPonctuel(s))).status).toBe(409);       // Salle B est prise le 14 déc.
            await accepter((await creer(annulation(e), ens2Token)).id);      // ens2 annule son cours du 14 déc.
            expect((await demander(depPonctuel(s))).status).toBe(201);       // Salle B est maintenant libre ce jour-là
        });
    });

    describe('déplacement définitif accepté', () => {
        test('libère l’ancien créneau et occupe le nouveau', async () => {
            const s = await creerSeance();
            await accepter((await creer(depDefinitif(s))).id); // lundi → mardi 8h

            expect((await demanderReservation({ creneau_id: ids.d1214 })).status).toBe(201);                // lundi libre
            const mardi = await demanderReservation({ creneau_id: ids.d1215 });                              // mardi occupé
            expect(mardi.status).toBe(409);
            expect(mardi.body.message).toMatch(/salle.*cours/i);
        });
    });

    describe('suppression et demandes liées', () => {
        test('supprimer une séance supprime ses demandes (pas d’erreur de clé étrangère)', async () => {
            const s = await creerSeance();
            await creer(annulation(s));
            await creer(depDefinitif(s));
            const res = await request(app).delete(`/api/edts/${ids.s1}/seances/${s.id}`).set(auth(adminToken));
            expect(res.status).toBe(200);
            expect(await compter('demande_changement')).toBe(0);
        });

        test('supprimer un EDT supprime ses séances et leurs demandes', async () => {
            const s = await creerSeance();
            await accepter((await creer(annulation(s))).id);
            const res = await request(app).delete(`/api/edts/${ids.s1}`).set(auth(adminToken));
            expect(res.status).toBe(200);
            expect(await compter('seance')).toBe(0);
            expect(await compter('demande_changement')).toBe(0);
        });
    });
});
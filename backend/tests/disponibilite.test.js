const request = require('supertest');
const app = require('../src/app');
const { pool, resetDb, seed, tokenFor, FAKE_TIMERS, NOW } = require('./helpers');

// Protection des RÉSERVATIONS CONFIRMÉES quand on ajoute ou modifie une séance de l'EDT.

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

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Séance par défaut : ens1, Salle A, lundi 8h-10h récurrent, groupe G1
const corpsSeance = (o = {}) => ({
    enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
    creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1], ...o,
});
const ajouterSeance = (o = {}, edtId = ids.s1) =>
    request(app).post(`/api/edts/${edtId}/seances`).set(auth(adminToken)).send(corpsSeance(o));

// Réservation par défaut : ens2, Salle A, lundi 14 décembre 8h-10h, groupe G2
const reserver = (o = {}) => request(app).post('/api/reservations').set(auth(ens2Token)).send({
    salle_id: ids.salleA, creneau_id: ids.d1214, groupe_id: ids.g2, evenement_id: ids.cours, ...o,
});
const traiterResa = (id, body) => request(app).put(`/api/reservations/${id}/traiter`).set(auth(adminToken)).send(body);
const reservationConfirmee = async (o = {}) => {
    const r = await reserver(o);
    expect(r.status).toBe(201);
    expect((await traiterResa(r.body.reservation.id, { statut: 'confirmee' })).status).toBe(200);
    return r.body.reservation;
};

describe('Séances - protection des réservations confirmées', () => {
    test('séance récurrente sur la salle d’une réservation confirmée de la période → 409', async () => {
        await reservationConfirmee();
        const res = await ajouterSeance();
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/salle.*r[ée]servation/i);
    });

    test('même enseignant que la réservation → 409', async () => {
        await reservationConfirmee({ salle_id: ids.salleB });
        const res = await ajouterSeance({ enseignant_id: ids.ens2, groupe_ids: [ids.g1] });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/enseignant/i);
    });

    test('même groupe que la réservation → 409', async () => {
        await reservationConfirmee({ salle_id: ids.salleB, groupe_id: ids.g1 });
        const res = await ajouterSeance();
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/groupe/i);
    });

    test('réservation après la fin de l’EDT (21 déc.) → pas de conflit → 201', async () => {
        await reservationConfirmee({ creneau_id: ids.d1221 });
        expect((await ajouterSeance()).status).toBe(201);
    });

    test('même EDT mais un autre semestre (S2, 2027) → pas de conflit → 201', async () => {
        await reservationConfirmee();
        expect((await ajouterSeance({}, ids.s2)).status).toBe(201);
    });

    test('autre jour de la semaine (réservation le mardi, séance le lundi) → 201', async () => {
        await reservationConfirmee({ creneau_id: ids.d1215 });
        expect((await ajouterSeance()).status).toBe(201);
    });

    test('même jour de la semaine (réservation le mardi, séance le mardi) → 409', async () => {
        await reservationConfirmee({ creneau_id: ids.d1215 });
        const res = await ajouterSeance({ creneau_id: ids.mar8 });
        expect(res.status).toBe(409);
    });

    test('chevauchement partiel (réservation 9h-11h, séance 8h-10h) → 409', async () => {
        await reservationConfirmee({ creneau_id: ids.d1214b });
        expect((await ajouterSeance()).status).toBe(409);
    });

    test('créneaux qui se touchent (réservation 8h-10h, séance 10h-12h) → 201', async () => {
        await reservationConfirmee();
        expect((await ajouterSeance({ creneau_id: ids.lun10 })).status).toBe(201);
    });

    test('séance datée le même jour → 409, un autre jour → 201', async () => {
        await reservationConfirmee();
        expect((await ajouterSeance({ creneau_id: ids.d1214 })).status).toBe(409);
        expect((await ajouterSeance({ creneau_id: ids.d1207 })).status).toBe(201);
    });

    test('une réservation en attente ne bloque pas la séance', async () => {
        expect((await reserver()).status).toBe(201);
        expect((await ajouterSeance()).status).toBe(201);
    });

    test('une réservation rejetée ou annulée ne bloque pas la séance', async () => {
        const rejetee = await reserver();
        await traiterResa(rejetee.body.reservation.id, { statut: 'rejetee', motif_rejet: 'Non' });
        const annulee = await reserver({ creneau_id: ids.d1215, salle_id: ids.salleB });
        await traiterResa(annulee.body.reservation.id, { statut: 'confirmee' });
        await request(app).put(`/api/reservations/${annulee.body.reservation.id}/annuler`).set(auth(ens2Token));

        expect((await ajouterSeance()).status).toBe(201);
        expect((await ajouterSeance({ creneau_id: ids.mar8, salle_id: ids.salleB, enseignant_id: ids.ens2, groupe_ids: [ids.g2] })).status).toBe(201);
    });

    test('modifier une séance vers un créneau réservé (réservation confirmée) → 409', async () => {
        const s = (await ajouterSeance()).body.seance;
        await reservationConfirmee({ creneau_id: ids.d1215 });
        const res = await request(app).put(`/api/edts/${ids.s1}/seances/${s.id}`).set(auth(adminToken))
            .send(corpsSeance({ creneau_id: ids.mar8 }));
        expect(res.status).toBe(409);
    });

    test('modifier une séance sans rien changer, avec des réservations ailleurs → 200', async () => {
        const s = (await ajouterSeance()).body.seance;
        await reservationConfirmee({ creneau_id: ids.d1215 });
        const res = await request(app).put(`/api/edts/${ids.s1}/seances/${s.id}`).set(auth(adminToken)).send(corpsSeance());
        expect(res.status).toBe(200);
    });
});

const request = require('supertest');
const app = require('../src/app');
const { pool, resetDb, seed, tokenFor } = require('./helpers');

let ids, adminToken, ensToken;

beforeEach(async () => {
    await resetDb();
    ids = await seed();
    adminToken = tokenFor({ id: ids.admin, role: 'admin' });
    ensToken = tokenFor({ id: ids.ens1, role: 'enseignant' });
});

afterAll(() => pool.end());

const nouvelEdt = (o = {}) => ({
    titre: 'EDT de test',
    annee_universitaire: '2026-2027',
    semestre: 'S1',
    date_debut: '2027-01-05',
    date_fin: '2027-06-30',
    filiere_id: ids.f1,
    ...o,
});

const creer = (body, token = adminToken) =>
    request(app).post('/api/edts').set('Authorization', `Bearer ${token}`).send(body);

const compter = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count);

describe('EDT - authentification et rôles', () => {
    test('GET sans token → 401', async () => {
        const res = await request(app).get('/api/edts');
        expect(res.status).toBe(401);
    });

    test('GET avec un token invalide → 401', async () => {
        const res = await request(app).get('/api/edts').set('Authorization', 'Bearer pas.un.token');
        expect(res.status).toBe(401);
    });

    test('un enseignant peut lister les EDT → 200', async () => {
        const res = await request(app).get('/api/edts').set('Authorization', `Bearer ${ensToken}`);
        expect(res.status).toBe(200);
    });

    test('un enseignant ne peut pas créer un EDT → 403', async () => {
        const res = await creer(nouvelEdt(), ensToken);
        expect(res.status).toBe(403);
    });

    test('un enseignant ne peut pas supprimer un EDT → 403', async () => {
        const res = await request(app).delete(`/api/edts/${ids.s1}`).set('Authorization', `Bearer ${ensToken}`);
        expect(res.status).toBe(403);
        expect(await compter('edt')).toBe(4);
    });
});

describe('EDT - création', () => {
    test('admin, données valides → 201', async () => {
        const res = await creer(nouvelEdt());
        expect(res.status).toBe(201);
        expect(res.body.edt).toMatchObject({
            titre: 'EDT de test',
            annee_universitaire: '2026-2027',
            semestre: 'S1',
            filiere_id: ids.f1,
        });
        expect(await compter('edt')).toBe(5);
    });

    test('les dates sont renvoyées telles quelles, sans décalage de fuseau', async () => {
        const res = await creer(nouvelEdt());
        expect(res.body.edt.date_debut).toBe('2027-01-05');
        expect(res.body.edt.date_fin).toBe('2027-06-30');
    });

    test.each(['titre', 'annee_universitaire', 'semestre', 'date_debut', 'date_fin', 'filiere_id'])(
        'champ %s manquant → 400',
        async (champ) => {
            const body = nouvelEdt();
            delete body[champ];
            const res = await creer(body);
            expect(res.status).toBe(400);
            expect(await compter('edt')).toBe(4);
        }
    );

    test('filière inexistante → 400', async () => {
        const res = await creer(nouvelEdt({ filiere_id: 9999 }));
        expect(res.status).toBe(400);
    });

    test('date_fin avant date_debut → 400', async () => {
        const res = await creer(nouvelEdt({ date_debut: '2027-06-30', date_fin: '2027-01-05' }));
        expect(res.status).toBe(400);
        expect(await compter('edt')).toBe(4);
    });

    test('date_fin égale à date_debut → 201 (autorisé)', async () => {
        const res = await creer(nouvelEdt({ date_debut: '2027-01-05', date_fin: '2027-01-05' }));
        expect(res.status).toBe(201);
    });

    test("année universitaire au mauvais format → 400", async () => {
        const res = await creer(nouvelEdt({ annee_universitaire: '2026' }));
        expect(res.status).toBe(400);
    });

    test('date illisible → 400', async () => {
        const res = await creer(nouvelEdt({ date_debut: 'pas-une-date' }));
        expect(res.status).toBe(400);
    });
});

describe('EDT - liste', () => {
    test('retourne tous les EDT avec le nom de la filière', async () => {
        const res = await request(app).get('/api/edts').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(4);
        expect(res.body[0]).toMatchObject({ id: ids.s1, titre: 'S1 GI', nom_filiere: 'Génie Informatique' });
    });

    test('les dates de la liste sont au format YYYY-MM-DD', async () => {
        const res = await request(app).get('/api/edts').set('Authorization', `Bearer ${adminToken}`);
        expect(res.body[0].date_debut).toBe('2026-09-01');
        expect(res.body[0].date_fin).toBe('2026-12-20');
    });
});

describe('EDT - suppression', () => {
    const supprimer = (id, token = adminToken) =>
        request(app).delete(`/api/edts/${id}`).set('Authorization', `Bearer ${token}`);

    test('admin → 200 et l’EDT disparaît', async () => {
        const res = await supprimer(ids.s2);
        expect(res.status).toBe(200);
        expect(await compter('edt')).toBe(3);
    });

    test('EDT inexistant → 404', async () => {
        const res = await supprimer(9999);
        expect(res.status).toBe(404);
    });

    test('identifiant non numérique → 400', async () => {
        const res = await supprimer('abc');
        expect(res.status).toBe(400);
    });

    test('supprimer un EDT supprime aussi ses séances et leurs groupes', async () => {
        const creerSeance = await request(app)
            .post(`/api/edts/${ids.s1}/seances`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
                creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1],
            });
        expect(creerSeance.status).toBe(201);
        expect(await compter('seance')).toBe(1);
        expect(await compter('seance_groupe')).toBe(1);

        const res = await supprimer(ids.s1);
        expect(res.status).toBe(200);
        expect(await compter('seance')).toBe(0);
        expect(await compter('seance_groupe')).toBe(0);
    });
});

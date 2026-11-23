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

// On fige la DATE du jour : les créneaux du seed (décembre 2026) restent dans le futur
// quelle que soit la date réelle d'exécution des tests. Seul Date est simulé.
const NOW = new Date('2026-11-21T10:00:00');
beforeAll(() => {
    jest.useFakeTimers({
        now: NOW,
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
            'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
});

afterAll(async () => {
    jest.useRealTimers();
    await pool.end();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// On utilise ids.d1214 (Lundi 14 Déc, 8h-10h) qui est un créneau DATÉ dans le seed
const nouvelleResa = (o = {}) => ({
    salle_id: ids.salleA,
    creneau_id: ids.d1214, 
    groupe_id: ids.g1,
    evenement_id: ids.cours,
    ...o
});

const demander = (body, token = ensToken) =>
    request(app).post('/api/reservations').set(auth(token)).send(body);

const creerResa = async (o = {}) => {
    const res = await demander(nouvelleResa(o));
    expect(res.status).toBe(201);
    return res.body.reservation;
};

const traiter = (id, body, token = adminToken) =>
    request(app).put(`/api/reservations/${id}/traiter`).set(auth(token)).send(body);

const annuler = (id, token = ensToken) =>
    request(app).put(`/api/reservations/${id}/annuler`).set(auth(token));

const lister = (token = adminToken) =>
    request(app).get('/api/reservations').set(auth(token));

describe('Réservations - Création', () => {
    test('un enseignant crée une demande → 201, statut en_attente', async () => {
        const res = await demander(nouvelleResa());
        expect(res.status).toBe(201);
        expect(res.body.reservation.statut).toBe('en_attente');
    });

    test('champs manquants → 400', async () => {
        const res = await demander({ salle_id: ids.salleA });
        expect(res.status).toBe(400);
    });

    test('tenter de réserver sur un créneau récurrent (date NULL) → 400', async () => {
        const res = await demander(nouvelleResa({ creneau_id: ids.lun8 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/daté/i);
    });

    test('salle en maintenance → 409', async () => {
        const res = await demander(nouvelleResa({ salle_id: ids.maintenance }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/maintenance/i);
    });

    test('conflit avec une Séance (EDT) existante → 409', async () => {
        // Créer une séance dans l'EDT le 14 Déc (d1214) Salle A
        await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({
            enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, creneau_id: ids.d1214, evenement_id: ids.cours, groupe_ids: [ids.g2]
        });

        // Tenter de réserver la même salle au même moment
        const res = await demander(nouvelleResa());
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/salle.*cours/i);
    });

    test('ids envoyés en texte → doit quand même détecter le conflit avec l\'EDT', async () => {
        // Créer une séance EDT le 14 Déc (d1214) Salle A
        await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({
            enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, creneau_id: ids.d1214, evenement_id: ids.cours, groupe_ids: [ids.g2]
        });

        // Tenter de réserver avec des IDs en texte
        const res = await demander(nouvelleResa({
            salle_id: String(ids.salleA),
            creneau_id: String(ids.d1214),
            groupe_id: String(ids.g1)
        }));
        expect(res.status).toBe(409);
    });

    test('tenter de réserver une date passée → 409', async () => {
        // On crée un créneau daté dans le passé
        const passeId = (await pool.query(`
            INSERT INTO creneau (date_creneau, jour, heure_debut, heure_fin)
            VALUES ('2020-01-06', 'lundi', '08:00', '10:00') RETURNING id
        `)).rows[0].id;

        const res = await demander(nouvelleResa({ creneau_id: passeId }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/passée/i);
    });

    test('capacité de la salle insuffisante → 409', async () => {
        // petite salle capacité 20, groupe g1 effectif 30
        const res = await demander(nouvelleResa({ salle_id: ids.petite }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/capacit/i);
    });

    test.each([
        ['salle_id', 'abc'],
        ['groupe_id', 1.5],
        ['creneau_id', 'x'],
        ['evenement_id', 'abc'],
        ['groupe_id', 0],
    ])('identifiant invalide (%s = %p) → 400', async (champ, valeur) => {
        const res = await demander(nouvelleResa({ [champ]: valeur }));
        expect(res.status).toBe(400);
    });

    test('groupe inexistant → 400', async () => {
        const res = await demander(nouvelleResa({ groupe_id: 9999 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/groupe/i);
    });

    test('réserver le jour même d\'une séance qui a déjà fini sa période (EDT terminé) → 201', async () => {
        // Séance récurrente lundi 8h en S1 (fin le 20 déc.) ; le lundi 21 déc. la salle est libre
        await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({
            enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g2]
        });
        const res = await demander(nouvelleResa({ creneau_id: ids.d1221 }));
        expect(res.status).toBe(201);
    });

    test('un admin ne peut pas créer une réservation → 403', async () => {
        const res = await demander(nouvelleResa(), adminToken);
        expect(res.status).toBe(403);
    });
});

describe('Réservations - Traitement Admin', () => {
    test('un enseignant ne peut pas traiter → 403', async () => {
        const resa = await creerResa();
        const res = await traiter(resa.id, { statut: 'confirmee' }, ensToken);
        expect(res.status).toBe(403);
    });

    test('admin confirme → 200', async () => {
        const resa = await creerResa();
        const res = await traiter(resa.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        expect(res.body.reservation.statut).toBe('confirmee');
    });

    test('admin rejette sans motif → 400', async () => {
        const resa = await creerResa();
        const res = await traiter(resa.id, { statut: 'rejetee' });
        expect(res.status).toBe(400);
    });

    test('admin rejette avec motif → 200', async () => {
        const resa = await creerResa();
        const res = await traiter(resa.id, { statut: 'rejetee', motif_rejet: 'Salle réservée' });
        expect(res.status).toBe(200);
        expect(res.body.reservation.statut).toBe('rejetee');
    });

    test('confirmer une réservation refuse automatiquement celle qui visait la même place', async () => {
        // 2 demandes en attente pour la même salle/créneau
        const resa1 = await creerResa();
        const resa2 = await creerResa({ groupe_id: ids.g2 });

        const conf = await traiter(resa1.id, { statut: 'confirmee' });
        expect(conf.status).toBe(200);
        expect(conf.body.refusees).toEqual([{ type: 'reservation', id: resa2.id }]);

        const ligne = (await pool.query('SELECT statut, motif_rejet, admin_id FROM reservation WHERE id = $1', [resa2.id])).rows[0];
        expect(ligne.statut).toBe('rejetee');
        expect(ligne.motif_rejet).toMatch(/Conflit/);
        expect(ligne.admin_id).toBe(ids.admin);

        // la 2ème est déjà traitée
        expect((await traiter(resa2.id, { statut: 'confirmee' })).status).toBe(400);
    });

    test('confirmation impossible si un cours a pris la place entre-temps → 409', async () => {
        const resa = await creerResa();
        await request(app).post(`/api/edts/${ids.s1}/seances`).set(auth(adminToken)).send({
            enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, creneau_id: ids.d1214, evenement_id: ids.cours, groupe_ids: [ids.g2]
        });
        const res = await traiter(resa.id, { statut: 'confirmee' });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/Impossible de confirmer/);
    });

    test('traiter avec un id non numérique → 400', async () => {
        const res = await traiter('abc', { statut: 'confirmee' });
        expect(res.status).toBe(400);
    });
});

describe('Réservations - Annulation', () => {
    test('l\'enseignant annule sa propre demande en attente → 200', async () => {
        const resa = await creerResa();
        const res = await annuler(resa.id);
        expect(res.status).toBe(200);
        expect(res.body.reservation.statut).toBe('annulee');
    });

    test('l\'enseignant annule sa propre demande confirmée → 200', async () => {
        const resa = await creerResa();
        await traiter(resa.id, { statut: 'confirmee' });
        
        const res = await annuler(resa.id);
        expect(res.status).toBe(200);
        expect(res.body.reservation.statut).toBe('annulee');
    });

    test('un autre enseignant ne peut pas annuler → 403', async () => {
        const resa = await creerResa();
        const ens2Token = tokenFor({ id: ids.ens2, role: 'enseignant' });
        
        const res = await annuler(resa.id, ens2Token);
        expect(res.status).toBe(403);
    });

    test('impossible d\'annuler une réservation déjà rejetée → 400', async () => {
        const resa = await creerResa();
        await traiter(resa.id, { statut: 'rejetee', motif_rejet: 'Non' });
        
        const res = await annuler(resa.id);
        expect(res.status).toBe(400);
    });

    test('annuler avec un id non numérique → 400', async () => {
        const res = await annuler('abc');
        expect(res.status).toBe(400);
    });
});

describe('Réservations - conflits avec les réservations confirmées', () => {
    const ens2Token = () => tokenFor({ id: ids.ens2, role: 'enseignant' });

    // Réservation confirmée : ens1, Salle A, 14 déc. 8h-10h, groupe G1
    const confirmeeDe = async () => {
        const resa = await creerResa();
        const res = await traiter(resa.id, { statut: 'confirmee' });
        expect(res.status).toBe(200);
        return resa;
    };

    test('même salle, horaires qui se chevauchent (8h-10h puis 9h-11h) → 409', async () => {
        await confirmeeDe();
        const res = await demander(nouvelleResa({ creneau_id: ids.d1214b, groupe_id: ids.g2 }), ens2Token());
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/salle/i);
    });

    test('même enseignant, autre salle, autre groupe → 409', async () => {
        await confirmeeDe();
        const res = await demander(nouvelleResa({ creneau_id: ids.d1214b, salle_id: ids.salleB, groupe_id: ids.g2 }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/enseignant/i);
    });

    test('même groupe, autre salle, autre enseignant → 409', async () => {
        await confirmeeDe();
        const res = await demander(nouvelleResa({ salle_id: ids.salleB }), ens2Token());
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/groupe/i);
    });

    test('même groupe avec un id en texte → 409', async () => {
        await confirmeeDe();
        const res = await demander(nouvelleResa({ salle_id: ids.salleB, groupe_id: String(ids.g1) }), ens2Token());
        expect(res.status).toBe(409);
    });

    test('créneaux qui se touchent (8h-10h puis 10h-12h), tout identique → 201', async () => {
        await confirmeeDe();
        const lundi14_10h = (await pool.query(
            `INSERT INTO creneau (date_creneau, jour, heure_debut, heure_fin) VALUES ('2026-12-14','lundi','10:00','12:00') RETURNING id`
        )).rows[0].id;
        const res = await demander(nouvelleResa({ creneau_id: lundi14_10h }));
        expect(res.status).toBe(201);
    });

    test('tout différent au même créneau (salle, enseignant, groupe) → 201', async () => {
        await confirmeeDe();
        const res = await demander(nouvelleResa({ salle_id: ids.salleB, groupe_id: ids.g2 }), ens2Token());
        expect(res.status).toBe(201);
    });

    test('une demande en attente ne bloque personne', async () => {
        await creerResa(); // reste en attente
        const res = await demander(nouvelleResa({ groupe_id: ids.g2 }), ens2Token());
        expect(res.status).toBe(201);
    });

    test('chevauchement partiel : confirmer l’une refuse automatiquement l’autre', async () => {
        const resa1 = await creerResa();
        const r2 = await demander(nouvelleResa({ creneau_id: ids.d1214b, groupe_id: ids.g2 }), ens2Token());
        expect(r2.status).toBe(201);

        const conf = await traiter(resa1.id, { statut: 'confirmee' });
        expect(conf.status).toBe(200);
        expect(conf.body.refusees).toEqual([{ type: 'reservation', id: r2.body.reservation.id }]);
        expect((await traiter(r2.body.reservation.id, { statut: 'confirmee' })).status).toBe(400);
    });

    test('une réservation annulée libère le créneau', async () => {
        const resa1 = await creerResa();
        await traiter(resa1.id, { statut: 'confirmee' });
        await annuler(resa1.id);

        const res = await demander(nouvelleResa({ groupe_id: ids.g2 }), ens2Token());
        expect(res.status).toBe(201);
        const conf = await traiter(res.body.reservation.id, { statut: 'confirmee' });
        expect(conf.status).toBe(200);
    });

    test('une réservation rejetée ne bloque pas le créneau', async () => {
        const resa1 = await creerResa();
        await traiter(resa1.id, { statut: 'rejetee', motif_rejet: 'Non' });

        const resa2 = await creerResa({ groupe_id: ids.g2 });
        const conf = await traiter(resa2.id, { statut: 'confirmee' });
        expect(conf.status).toBe(200);
    });
});

describe('Réservations - Liste', () => {
    test('la liste contient salle, créneau, groupe et enseignant', async () => {
        await creerResa();
        const res = await lister(adminToken);
        expect(res.body[0]).toMatchObject({
            nom_salle: 'Salle A', nom_groupe: 'G1', evenement: 'Cours',
            date_creneau: '2026-12-14', heure_debut: '08:00:00', enseignant_nom: 'Alami',
        });
    });

    test('un enseignant ne voit que ses propres réservations', async () => {
        await creerResa();
        const ens2Token = tokenFor({ id: ids.ens2, role: 'enseignant' });
        await request(app).post('/api/reservations').set(auth(ens2Token)).send({
            salle_id: ids.salleB, creneau_id: ids.d1214, groupe_id: ids.g2, evenement_id: ids.cours
        });

        const res = await lister(ensToken);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].enseignant_id).toBe(ids.ens1);
    });

    test('un admin voit toutes les réservations', async () => {
        await creerResa();
        const ens2Token = tokenFor({ id: ids.ens2, role: 'enseignant' });
        await request(app).post('/api/reservations').set(auth(ens2Token)).send({
            salle_id: ids.salleB, creneau_id: ids.d1214, groupe_id: ids.g2, evenement_id: ids.cours
        });

        const res = await lister(adminToken);
        expect(res.body).toHaveLength(2);
    });
});
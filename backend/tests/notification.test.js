const request = require('supertest');
const app = require('../src/app');
const { pool, resetDb, seed, tokenFor, FAKE_TIMERS, NOW } = require('./helpers');
const { tronquer, LONGUEUR_MAX } = require('../src/services/notificationService');

let ids, adminToken, admin2Token, ens1Token, ens2Token;

beforeAll(() => jest.useFakeTimers(FAKE_TIMERS));
afterAll(async () => {
    jest.useRealTimers();
    await pool.end();
});

beforeEach(async () => {
    jest.setSystemTime(NOW);
    await resetDb();
    ids = await seed();
    // un 2ème administrateur, pour vérifier "tous les admins" et "sauf celui qui agit"
    ids.admin2 = (await pool.query(
        "INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role) VALUES ('Admin2', 'Test', 'admin2@test.ma', 'hash', 'admin') RETURNING id")).rows[0].id;
    adminToken = tokenFor({ id: ids.admin, role: 'admin' });
    admin2Token = tokenFor({ id: ids.admin2, role: 'admin' });
    ens1Token = tokenFor({ id: ids.ens1, role: 'enseignant' });
    ens2Token = tokenFor({ id: ids.ens2, role: 'enseignant' });
});

// ---------- Outils ----------
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const api = (method, url, token, body) => {
    const r = request(app)[method](url).set(auth(token));
    return body === undefined ? r : r.send(body);
};
// Messages reçus par une personne, du plus ancien au plus récent (lus directement en base)
const messages = async (userId) =>
    (await pool.query('SELECT message FROM notification WHERE utilisateur_id = $1 ORDER BY id', [userId])).rows.map((r) => r.message);
const nombre = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count);
const insererNotif = (userId, message, estLu = false) => pool.query(
    'INSERT INTO notification (message, utilisateur_id, est_lu) VALUES ($1, $2, $3) RETURNING id', [message, userId, estLu]).then((r) => r.rows[0].id);

const reserver = (token, o = {}) => api('post', '/api/reservations', token, {
    salle_id: ids.salleA, creneau_id: ids.d1215, groupe_id: ids.g1, evenement_id: ids.cours, ...o,
});
const creerResa = async (token, o) => { const r = await reserver(token, o); expect(r.status).toBe(201); return r.body.reservation; };
const traiterResa = (id, body) => api('put', `/api/reservations/${id}/traiter`, adminToken, body);
const corpsSeance = (o = {}) => ({
    enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
    creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1], ...o,
});
const creerSeance = async (o, edtId = ids.s1) => {
    const r = await api('post', `/api/edts/${edtId}/seances`, adminToken, corpsSeance(o));
    expect(r.status).toBe(201);
    return r.body.seance;
};
const demander = (token, body) => api('post', '/api/demandes-changement', token, body);
const creerDemande = async (token, body) => { const r = await demander(token, body); expect(r.status).toBe(201); return r.body.demande; };
const traiterDemande = (id, body) => api('put', `/api/demandes-changement/${id}/traiter`, adminToken, body);
const ponctuel = (s, o = {}) => ({ type_demande: 'deplacement_ponctuel', seance_id: s.id, date_occurrence: '2026-12-14', ...o });

const RESA_A = 'salle « Salle A », le 2026-12-15 de 08:00 à 10:00, groupe G1';
const SEANCE_A = '« Algorithmique » (Salle A, chaque lundi de 08:00 à 10:00)';

// ============================================================
describe('Notifications - routes', () => {
    test.each([['get', '/api/notifications'], ['get', '/api/notifications/non-lues'], ['put', '/api/notifications/lues'], ['put', '/api/notifications/1/lue']])(
        'sans token : %s %s → 401', async (methode, url) => {
            expect((await request(app)[methode](url)).status).toBe(401);
        });

    test('chacun ne voit que ses notifications, les plus récentes d’abord (enseignant comme admin)', async () => {
        await insererNotif(ids.ens1, 'ancienne');
        await insererNotif(ids.ens1, 'récente');
        await insererNotif(ids.ens2, 'pour quelqu’un d’autre');
        await insererNotif(ids.admin, 'pour l’admin');

        const ens = (await api('get', '/api/notifications', ens1Token)).body;
        expect(ens.map((n) => n.message)).toEqual(['récente', 'ancienne']);
        expect(ens[0]).toEqual({ id: expect.any(Number), message: 'récente', date_creation: expect.any(String), est_lu: false });
        expect((await api('get', '/api/notifications', adminToken)).body.map((n) => n.message)).toEqual(['pour l’admin']);
    });

    test('aucune notification → tableau vide', async () => {
        const res = await api('get', '/api/notifications', ens1Token);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('filtre ?non_lues=true et compteur', async () => {
        await insererNotif(ids.ens1, 'lue', true);
        await insererNotif(ids.ens1, 'non lue 1');
        await insererNotif(ids.ens1, 'non lue 2');
        expect((await api('get', '/api/notifications?non_lues=true', ens1Token)).body.map((n) => n.message)).toEqual(['non lue 2', 'non lue 1']);
        expect((await api('get', '/api/notifications?non_lues=false', ens1Token)).body).toHaveLength(3);
        expect((await api('get', '/api/notifications/non-lues', ens1Token)).body).toEqual({ non_lues: 2 });
        expect((await api('get', '/api/notifications/non-lues', ens2Token)).body).toEqual({ non_lues: 0 });
    });

    test('pagination', async () => {
        for (let i = 1; i <= 5; i++) await insererNotif(ids.ens1, `n${i}`);
        expect((await api('get', '/api/notifications?limit=2', ens1Token)).body.map((n) => n.message)).toEqual(['n5', 'n4']);
        expect((await api('get', '/api/notifications?limit=2&offset=2', ens1Token)).body.map((n) => n.message)).toEqual(['n3', 'n2']);
        expect((await api('get', '/api/notifications?limit=2&offset=10', ens1Token)).body).toEqual([]);
    });

    test.each([['non_lues=oui'], ['limit=0'], ['limit=201'], ['limit=abc'], ['offset=-1'], ['offset=abc']])(
        'paramètre invalide (%s) → 400', async (qs) => {
            expect((await api('get', `/api/notifications?${qs}`, ens1Token)).status).toBe(400);
        });

    test('marquer une notification comme lue', async () => {
        const id = await insererNotif(ids.ens1, 'à lire');
        const res = await api('put', `/api/notifications/${id}/lue`, ens1Token);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id, message: 'à lire', est_lu: true });
        expect((await api('get', '/api/notifications/non-lues', ens1Token)).body.non_lues).toBe(0);
        expect((await api('put', `/api/notifications/${id}/lue`, ens1Token)).status).toBe(200); // sans effet, sans erreur
    });

    test('on ne peut pas marquer la notification d’un autre (404, elle reste non lue)', async () => {
        const id = await insererNotif(ids.ens2, 'privée');
        expect((await api('put', `/api/notifications/${id}/lue`, ens1Token)).status).toBe(404);
        expect((await api('put', `/api/notifications/${id}/lue`, adminToken)).status).toBe(404);
        expect((await pool.query('SELECT est_lu FROM notification WHERE id = $1', [id])).rows[0].est_lu).toBe(false);
    });

    test('notification inexistante → 404 ; identifiant invalide → 400', async () => {
        expect((await api('put', '/api/notifications/99999/lue', ens1Token)).status).toBe(404);
        expect((await api('put', '/api/notifications/abc/lue', ens1Token)).status).toBe(400);
    });

    test('tout marquer comme lu : seulement les siennes', async () => {
        await insererNotif(ids.ens1, 'a');
        await insererNotif(ids.ens1, 'b');
        await insererNotif(ids.ens1, 'c', true);
        await insererNotif(ids.ens2, 'd');
        const res = await api('put', '/api/notifications/lues', ens1Token);
        expect(res.status).toBe(200);
        expect(res.body.modifiees).toBe(2);
        expect((await api('get', '/api/notifications/non-lues', ens1Token)).body.non_lues).toBe(0);
        expect((await api('get', '/api/notifications/non-lues', ens2Token)).body.non_lues).toBe(1);
        expect((await api('put', '/api/notifications/lues', ens1Token)).body.modifiees).toBe(0);
    });
});

// ============================================================
describe('Notifications - réservations', () => {
    test('nouvelle demande → tous les admins, pas l’enseignant', async () => {
        await creerResa(ens1Token);
        const attendu = [`Nouvelle demande de réservation de Test Alami : ${RESA_A}.`];
        expect(await messages(ids.admin)).toEqual(attendu);
        expect(await messages(ids.admin2)).toEqual(attendu);
        expect(await messages(ids.ens1)).toEqual([]);
        expect(await messages(ids.ens2)).toEqual([]);
    });

    test('confirmée → l’enseignant concerné seulement', async () => {
        const r = await creerResa(ens1Token);
        await traiterResa(r.id, { statut: 'confirmee' });
        expect(await messages(ids.ens1)).toEqual([`Votre réservation (${RESA_A}) a été confirmée.`]);
        expect(await messages(ids.ens2)).toEqual([]);
        expect(await messages(ids.admin)).toHaveLength(1); // seulement la demande initiale
    });

    test('rejetée → l’enseignant avec le motif', async () => {
        const r = await creerResa(ens1Token);
        await traiterResa(r.id, { statut: 'rejetee', motif_rejet: 'Examen prévu' });
        expect(await messages(ids.ens1)).toEqual([`Votre réservation (${RESA_A}) a été rejetée : Examen prévu`]);
    });

    test('refus automatique → l’enseignant dont la demande est refusée, avec la cause', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1 });
        const r2 = await creerResa(ens2Token, { groupe_id: ids.g2 });
        await traiterResa(r1.id, { statut: 'confirmee' });
        expect(await messages(ids.ens1)).toEqual([`Votre réservation (${RESA_A}) a été confirmée.`]);
        expect(await messages(ids.ens2)).toEqual([
            `Votre réservation (salle « Salle A », le 2026-12-15 de 08:00 à 10:00, groupe G2) a été rejetée : Conflit : la place a été attribuée à la réservation n°${r1.id}.`,
        ]);
        expect(r2).toBeTruthy();
    });

    test('réaffectée → l’enseignant, avec la nouvelle destination', async () => {
        const r = await creerResa(ens1Token);
        await api('put', `/api/reservations/${r.id}/reaffecter`, adminToken, { salle_id: ids.salleB, creneau_id: ids.d1216 });
        expect(await messages(ids.ens1)).toEqual([
            "Votre réservation a été réaffectée par l'administration et confirmée : salle « Salle B », le 2026-12-16 de 08:00 à 10:00, groupe G1.",
        ]);
    });

    test('annulation d’une réservation CONFIRMÉE → les admins ; d’une demande en attente → personne', async () => {
        const confirmee = await creerResa(ens1Token);
        await traiterResa(confirmee.id, { statut: 'confirmee' });
        const enAttente = await creerResa(ens2Token, { salle_id: ids.salleB, groupe_id: ids.g2 });
        const avant = await messages(ids.admin);

        await api('put', `/api/reservations/${enAttente.id}/annuler`, ens2Token);
        expect(await messages(ids.admin)).toEqual(avant); // rien de nouveau

        await api('put', `/api/reservations/${confirmee.id}/annuler`, ens1Token);
        const apres = await messages(ids.admin);
        expect(apres).toHaveLength(avant.length + 1);
        expect(apres[apres.length - 1]).toBe(`Test Alami a annulé sa réservation confirmée (${RESA_A}).`);
        expect(await messages(ids.admin2)).toEqual(apres);
        expect((await messages(ids.ens1)).length).toBe(1); // l'enseignant ne se notifie pas lui-même
    });

    test('une opération refusée ne notifie personne', async () => {
        const r = await creerResa(ens1Token);
        await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleA, creneau_id: ids.mar8, groupe_ids: [ids.g2] });
        const avant = await nombre('notification');
        expect((await traiterResa(r.id, { statut: 'confirmee' })).status).toBe(409);
        expect((await reserver(ens1Token, { salle_id: ids.maintenance })).status).toBe(409);
        expect((await traiterResa(r.id, { statut: 'rejetee' })).status).toBe(400);
        expect(await nombre('notification')).toBe(avant);
    });
});

// ============================================================
describe('Notifications - demandes de changement', () => {
    const DEMANDE_SALLE_B = 'déplacement ponctuel de la séance « Algorithmique » du 2026-12-14 → salle « Salle B »';

    test('nouvelle demande → tous les admins', async () => {
        const s = await creerSeance();
        await creerDemande(ens1Token, ponctuel(s, { nouvelle_salle_id: ids.salleB }));
        const attendu = [`Nouvelle demande de changement de Test Alami : ${DEMANDE_SALLE_B}.`];
        expect((await messages(ids.admin)).filter((m) => m.startsWith('Nouvelle demande de changement'))).toEqual(attendu);
        expect((await messages(ids.admin2)).filter((m) => m.startsWith('Nouvelle demande de changement'))).toEqual(attendu);
        expect(await messages(ids.ens1)).toHaveLength(1); // une séance lui a été attribuée, rien d'autre
    });

    test('acceptée → l’enseignant', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, ponctuel(s, { nouvelle_salle_id: ids.salleB }));
        await traiterDemande(d.id, { statut: 'acceptee' });
        expect((await messages(ids.ens1)).pop()).toBe(`Votre demande de changement (${DEMANDE_SALLE_B}) a été acceptée.`);
    });

    test('refusée → l’enseignant avec le motif', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14' });
        await traiterDemande(d.id, { statut: 'refusee', motif_refus: 'Pas de remplaçant' });
        expect((await messages(ids.ens1)).pop()).toBe(
            'Votre demande de changement (annulation ponctuelle de la séance « Algorithmique » du 2026-12-14) a été refusée : Pas de remplaçant');
    });

    test('réaffectée → l’enseignant, avec la nouvelle destination', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        await api('put', `/api/demandes-changement/${d.id}/reaffecter`, adminToken, { nouvelle_salle_id: ids.pile });
        expect((await messages(ids.ens1)).pop()).toBe(
            "Votre demande de changement a été modifiée par l'administration puis acceptée : déplacement ponctuel de la séance « Algorithmique » du 2026-12-14 → salle « Salle 60 », le 2026-12-15 de 08:00 à 10:00.");
    });

    test('refus automatique d’une demande de changement → son enseignant', async () => {
        const s = await creerSeance();
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        await traiterResa(r.id, { statut: 'confirmee' });
        const recu = (await messages(ids.ens1)).pop();
        expect(recu).toMatch(/^Votre demande de changement \(déplacement ponctuel .*\) a été refusée : Conflit : la place a été attribuée à la réservation n°/);
    });

    test('un déplacement définitif accepté notifie l’enseignant une seule fois', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, { type_demande: 'deplacement_definitif', seance_id: s.id, nouveau_creneau_id: ids.mar8 });
        const avant = (await messages(ids.ens1)).length;
        await traiterDemande(d.id, { statut: 'acceptee' });
        const apres = await messages(ids.ens1);
        expect(apres).toHaveLength(avant + 1);
        expect(apres.pop()).toMatch(/a été acceptée\.$/);
    });
});

// ============================================================
describe('Notifications - séances et EDT', () => {
    test('séance attribuée à un enseignant', async () => {
        await creerSeance();
        expect(await messages(ids.ens1)).toEqual([`Une séance vous a été attribuée : ${SEANCE_A}.`]);
        expect(await messages(ids.ens2)).toEqual([]);
    });

    test('séance modifiée (même enseignant)', async () => {
        const s = await creerSeance();
        await api('put', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken, corpsSeance({ salle_id: ids.salleB }));
        expect((await messages(ids.ens1)).pop()).toBe(
            `Votre séance a été modifiée : ${SEANCE_A} → « Algorithmique » (Salle B, chaque lundi de 08:00 à 10:00).`);
        expect(await messages(ids.ens2)).toEqual([]);
    });

    test('séance réattribuée à un autre enseignant : l’ancien et le nouveau sont prévenus', async () => {
        const s = await creerSeance();
        await api('put', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken, corpsSeance({ enseignant_id: ids.ens2 }));
        expect((await messages(ids.ens1)).pop()).toBe(`Vous n'êtes plus affecté à la séance ${SEANCE_A}.`);
        expect(await messages(ids.ens2)).toEqual([`Une séance vous a été attribuée : ${SEANCE_A}.`]);
    });

    test('séance supprimée', async () => {
        const s = await creerSeance();
        await api('delete', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken);
        expect((await messages(ids.ens1)).pop()).toBe(`Votre séance a été supprimée : ${SEANCE_A}.`);
    });

    test('EDT supprimé : chaque enseignant concerné est prévenu du nombre de séances perdues', async () => {
        await creerSeance();
        await creerSeance({ creneau_id: ids.mar8 });
        await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2] });
        await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2], creneau_id: ids.jeu8 }, ids.s1);
        await creerSeance({ salle_id: ids.salleB, groupe_ids: [ids.g2] }, ids.s2); // autre EDT : non concerné
        const avant1 = await messages(ids.ens1);

        await api('delete', `/api/edts/${ids.s1}`, adminToken);
        expect((await messages(ids.ens1)).slice(avant1.length)).toEqual(["L'emploi du temps « S1 GI » a été supprimé : 2 de vos séances ont été supprimées."]);
        expect((await messages(ids.ens2)).pop()).toBe("L'emploi du temps « S1 GI » a été supprimé : 2 de vos séances ont été supprimées.");
    });

    test('EDT supprimé avec une seule séance : accord au singulier', async () => {
        await creerSeance();
        await api('delete', `/api/edts/${ids.s1}`, adminToken);
        expect((await messages(ids.ens1)).pop()).toBe("L'emploi du temps « S1 GI » a été supprimé : 1 de vos séances a été supprimée.");
    });

    test('EDT supprimé sans séance : personne n’est notifié', async () => {
        const avant = await nombre('notification');
        await api('delete', `/api/edts/${ids.s2}`, adminToken);
        expect(await nombre('notification')).toBe(avant);
    });
});

// ============================================================
describe('Notifications - salle indisponible (pour les administrateurs)', () => {
    const modifierSalle = (id, o = {}) => api('put', `/api/salles/${id}`, adminToken, {
        nom_salle: 'Salle A', capacite: 40, type_salle: 'salle_td', etat: 'disponible', ...o,
    });

    test('maintenance : les AUTRES admins sont prévenus, avec le nombre de séances et de réservations touchées', async () => {
        await creerSeance();                                                       // 1 séance à venir en Salle A
        const r = await creerResa(ens2Token, { groupe_id: ids.g2 });               // 1 réservation confirmée à venir
        await traiterResa(r.id, { statut: 'confirmee' });
        const avantAdmin = (await messages(ids.admin)).length;
        const avantAdmin2 = (await messages(ids.admin2)).length;

        expect((await modifierSalle(ids.salleA, { etat: 'en_maintenance' })).status).toBe(200);
        const attendu = 'La salle « Salle A » est passée en maintenance : 1 séance(s) et 1 réservation(s) confirmée(s) à venir l\'utilisent : pensez à les adapter.';
        expect((await messages(ids.admin2)).slice(avantAdmin2)).toEqual([attendu]);
        expect((await messages(ids.admin)).slice(avantAdmin)).toEqual([]);        // l'admin qui agit n'est pas notifié
        expect(await messages(ids.ens1)).toHaveLength(1);                          // les enseignants non plus
    });

    test('indisponible, sans rien d’utilisé', async () => {
        await modifierSalle(ids.salleB, { nom_salle: 'Salle B', etat: 'indisponible' });
        expect((await messages(ids.admin2)).pop()).toBe("La salle « Salle B » est passée en indisponible : aucune séance ni réservation confirmée à venir ne l'utilise.");
    });

    test('seul ce qui est À VENIR compte (EDT terminé, réservation passée ignorés)', async () => {
        const ancienEdt = (await pool.query(
            `INSERT INTO edt (titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id)
             VALUES ('Ancien', '2025-2026', 'S2', '2026-01-05', '2026-06-30', $1) RETURNING id`, [ids.f1])).rows[0].id;
        await creerSeance({}, ancienEdt);
        await pool.query(
            `INSERT INTO reservation (statut, enseignant_id, salle_id, creneau_id, groupe_id, evenement_id)
             VALUES ('confirmee', $1, $2, $3, $4, $5)`, [ids.ens2, ids.salleA, ids.dPasse, ids.g2, ids.cours]);
        await modifierSalle(ids.salleA, { etat: 'en_maintenance' });
        expect((await messages(ids.admin2)).pop()).toMatch(/aucune séance ni réservation confirmée à venir/);
    });

    test('retour à « disponible », changement de nom ou passage maintenance → indisponible', async () => {
        await modifierSalle(ids.salleA, { etat: 'en_maintenance' });
        const apres1 = (await messages(ids.admin2)).length;
        await modifierSalle(ids.salleA, { etat: 'disponible' });
        await modifierSalle(ids.salleA, { nom_salle: 'Salle A renommée' });
        expect(await messages(ids.admin2)).toHaveLength(apres1);                    // rien de nouveau
        await modifierSalle(ids.salleA, { nom_salle: 'Salle A renommée', etat: 'indisponible' });
        expect((await messages(ids.admin2)).pop()).toMatch(/« Salle A renommée » est passée en indisponible/);
    });

    test('un seul admin (celui qui agit) : personne n’est notifié', async () => {
        await pool.query('DELETE FROM utilisateur WHERE id = $1', [ids.admin2]);
        const avant = await nombre('notification');
        await modifierSalle(ids.salleA, { etat: 'en_maintenance' });
        expect(await nombre('notification')).toBe(avant);
    });
});

// ============================================================
describe('Notifications - nouveaux conflits (pour les administrateurs)', () => {
    const conflits = () => api('get', '/api/conflits', adminToken);
    const messagesConflit = async (userId) => (await messages(userId)).filter((m) => m.startsWith('Nouveau conflit'));

    test('un conflit apparaît → tous les admins, une seule fois', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        expect(await messagesConflit(ids.admin)).toEqual([]);
        await creerResa(ens2Token, { groupe_id: ids.g2 });
        const attendu = ['Nouveau conflit : Salle « Salle A » — le 2026-12-15 de 08:00 à 10:00 : 2 demandes en concurrence'];
        expect(await messagesConflit(ids.admin)).toEqual(attendu);
        expect(await messagesConflit(ids.admin2)).toEqual(attendu);

        await conflits();
        await conflits();
        expect(await messagesConflit(ids.admin)).toEqual(attendu); // recalculer ne notifie pas à nouveau
    });

    test('un conflit qui grossit n’est pas re-notifié, un nouveau conflit l’est', async () => {
        const dix = (await pool.query(
            "INSERT INTO creneau (date_creneau, jour, heure_debut, heure_fin) VALUES ('2026-12-14', 'lundi', '10:00', '12:00') RETURNING id")).rows[0].id;
        await creerResa(ens1Token, { groupe_id: ids.g1, creneau_id: ids.d1214 });
        await creerResa(ens2Token, { groupe_id: ids.g2, creneau_id: ids.d1214b });
        expect(await messagesConflit(ids.admin)).toHaveLength(1);
        await creerResa(ens1Token, { groupe_id: ids.g3, creneau_id: dix }); // rejoint le même conflit
        expect(await messagesConflit(ids.admin)).toHaveLength(1);
        await creerResa(ens2Token, { groupe_id: ids.g1, salle_id: ids.salleB, creneau_id: ids.d1216 });
        await creerResa(ens1Token, { groupe_id: ids.g2, salle_id: ids.salleB, creneau_id: ids.d1216 });
        expect(await messagesConflit(ids.admin)).toHaveLength(2);
    });

    test('les enseignants ne reçoivent pas les notifications de conflit', async () => {
        await creerResa(ens1Token, { groupe_id: ids.g1 });
        await creerResa(ens2Token, { groupe_id: ids.g2 });
        expect(await messagesConflit(ids.ens1)).toEqual([]);
        expect(await messagesConflit(ids.ens2)).toEqual([]);
    });
});

// ============================================================
describe('Notifications - longueur et robustesse', () => {
    test('tronquer : un message trop long est coupé à 255 caractères avec « … »', () => {
        const long = tronquer('x'.repeat(400));
        expect(long).toHaveLength(LONGUEUR_MAX);
        expect(long.endsWith('…')).toBe(true);
        expect(tronquer('court')).toBe('court');
        expect(tronquer('y'.repeat(255))).toHaveLength(255);
    });

    test('un motif très long ne fait pas échouer le rejet : la notification est tronquée', async () => {
        const r = await creerResa(ens1Token);
        const res = await traiterResa(r.id, { statut: 'rejetee', motif_rejet: 'z'.repeat(250) });
        expect(res.status).toBe(200);
        const recu = (await messages(ids.ens1)).pop();
        expect(recu).toHaveLength(255);
        expect(recu.endsWith('…')).toBe(true);
    });

    describe('si les notifications ne marchent plus', () => {
        let erreurs;
        beforeEach(() => { erreurs = jest.spyOn(console, 'error').mockImplementation(() => {}); });
        afterEach(async () => {
            erreurs.mockRestore();
            await pool.query('ALTER TABLE IF EXISTS notification_x RENAME TO notification');
        });
        const casser = () => pool.query('ALTER TABLE notification RENAME TO notification_x');

        test('opérations simples : elles réussissent quand même (l’erreur est seulement journalisée)', async () => {
            await casser();
            expect((await reserver(ens1Token)).status).toBe(201);
            expect((await api('post', '/api/niveaux', adminToken, { libelle: 'Master', code_niveau: 'M1' })).status).toBe(201);
            expect(erreurs).toHaveBeenCalled();
        });

        test('confirmation : si la notification échoue, la décision est annulée (cohérence)', async () => {
            const r = await creerResa(ens1Token);
            await casser();
            expect((await traiterResa(r.id, { statut: 'confirmee' })).status).toBe(500);
            expect((await pool.query('SELECT statut FROM reservation WHERE id = $1', [r.id])).rows[0].statut).toBe('en_attente');
        });
    });
});

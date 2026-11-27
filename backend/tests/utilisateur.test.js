const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { pool, resetDb, seed, tokenFor, FAKE_TIMERS, NOW } = require('./helpers');

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
    ids.admin2 = (await pool.query(
        "INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role) VALUES ('Zaki', 'Admin', 'admin2@test.ma', 'hash', 'admin') RETURNING id")).rows[0].id;
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
const U = '/api/utilisateurs';
const corps = (o = {}) => ({ nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma', mot_de_passe: 'secret123', role: 'enseignant', ...o });
const creer = async (o) => { const r = await api('post', U, adminToken, corps(o)); expect(r.status).toBe(201); return r.body.user; };
const connexion = (email, mot_de_passe) => request(app).post('/api/auth/login').send({ email, mot_de_passe });
const histo = async (qs = '') => (await api('get', `/api/historique?limit=200${qs}`, adminToken)).body.resultats;
const nombre = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count);
const valeur = (e, cote = 'nouvelle_valeur') => (e[cote] === null ? null : JSON.parse(e[cote]));
const ligneBase = async (id) => (await pool.query('SELECT * FROM utilisateur WHERE id = $1', [id])).rows[0];

const creerSeance = async (o = {}, edtId = ids.s1) => {
    const r = await api('post', `/api/edts/${edtId}/seances`, adminToken, {
        enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA, creneau_id: ids.lun8,
        evenement_id: ids.cours, groupe_ids: [ids.g1], ...o,
    });
    expect(r.status).toBe(201);
    return r.body.seance;
};

// ============================================================
describe('Comptes - accès réservé aux administrateurs', () => {
    const ROUTES = [
        ['get', U], ['post', U], ['get', `${U}/1`], ['put', `${U}/1`],
        ['put', `${U}/1/desactiver`], ['put', `${U}/1/reactiver`], ['put', `${U}/1/mot-de-passe`],
    ];
    test.each(ROUTES)('sans token : %s %s → 401', async (methode, url) => {
        expect((await request(app)[methode](url).send({})).status).toBe(401);
    });
    test.each(ROUTES)('en tant qu’enseignant : %s %s → 403', async (methode, url) => {
        expect((await api(methode, url, ens1Token, {})).status).toBe(403);
    });
    test('il n’existe pas de suppression définitive (l’historique référence les comptes)', async () => {
        expect((await api('delete', `${U}/${ids.ens1}`, adminToken)).status).toBe(404);
        expect(await ligneBase(ids.ens1)).toBeTruthy();
    });
});

// ============================================================
describe('Comptes - liste', () => {
    test('liste complète, triée par nom, sans jamais exposer le mot de passe', async () => {
        const res = await api('get', U, adminToken);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ total: 4, limit: 50, offset: 0 });
        expect(res.body.resultats.map((u) => u.nom)).toEqual(['Admin', 'Alami', 'Bennani', 'Zaki']);
        for (const u of res.body.resultats) {
            expect(Object.keys(u).sort()).toEqual(['actif', 'email', 'id', 'nom', 'prenom', 'role']);
        }
        expect(JSON.stringify(res.body)).not.toMatch(/mot_de_passe|hash/);
    });

    test('filtre par rôle', async () => {
        expect((await api('get', `${U}?role=enseignant`, adminToken)).body.resultats.map((u) => u.nom)).toEqual(['Alami', 'Bennani']);
        expect((await api('get', `${U}?role=admin`, adminToken)).body.total).toBe(2);
    });

    test('filtre par état du compte', async () => {
        await api('put', `${U}/${ids.ens2}/desactiver`, adminToken);
        expect((await api('get', `${U}?actif=false`, adminToken)).body.resultats.map((u) => u.nom)).toEqual(['Bennani']);
        expect((await api('get', `${U}?actif=true`, adminToken)).body.total).toBe(3);
    });

    test('recherche par nom, par prénom ou par email, sans tenir compte des majuscules', async () => {
        await creer({ nom: 'Dupont', prenom: 'Clémence', email: 'xyz.unique@exemple.ma' });
        const noms = async (qs) => (await api('get', `${U}?recherche=${encodeURIComponent(qs)}`, adminToken)).body.resultats.map((u) => u.nom);
        expect(await noms('dupo')).toEqual(['Dupont']);          // nom
        expect(await noms('CLÉMEN')).toEqual(['Dupont']);        // prénom
        expect(await noms('xyz.unique@')).toEqual(['Dupont']);   // email
        expect(await noms('ALAMI')).toEqual(['Alami']);
        expect(await noms('ens2@')).toEqual(['Bennani']);
        expect(await noms('introuvable')).toEqual([]);
    });

    test('les caractères spéciaux de la recherche (% et _) sont traités comme du texte', async () => {
        const res = await api('get', `${U}?recherche=${encodeURIComponent('%')}`, adminToken);
        expect(res.body.total).toBe(0);
        expect((await api('get', `${U}?recherche=${encodeURIComponent('_')}`, adminToken)).body.total).toBe(0);
    });

    test('pagination', async () => {
        const page = await api('get', `${U}?limit=2&offset=1`, adminToken);
        expect(page.body).toMatchObject({ total: 4, limit: 2, offset: 1 });
        expect(page.body.resultats.map((u) => u.nom)).toEqual(['Alami', 'Bennani']);
    });

    test.each([['role=x'], ['actif=oui'], ['limit=0'], ['limit=201'], ['limit=abc'], ['offset=-1'], [`recherche=${'x'.repeat(101)}`]])(
        'paramètre invalide (%s) → 400', async (qs) => {
            expect((await api('get', `${U}?${qs}`, adminToken)).status).toBe(400);
        });
});

// ============================================================
describe('Comptes - consulter un compte', () => {
    test('profil + activité en cours (séances, réservations, demandes)', async () => {
        await creerSeance();                                                         // séance à venir
        const ancienEdt = (await pool.query(
            `INSERT INTO edt (titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id)
             VALUES ('Ancien', '2025-2026', 'S2', '2026-01-05', '2026-06-30', $1) RETURNING id`, [ids.f1])).rows[0].id;
        await creerSeance({}, ancienEdt);                                            // EDT terminé : ne compte pas
        const r = await api('post', '/api/reservations', ens1Token, { salle_id: ids.salleB, creneau_id: ids.d1215, groupe_id: ids.g1, evenement_id: ids.cours });
        await api('put', `/api/reservations/${r.body.reservation.id}/traiter`, adminToken, { statut: 'confirmee' });
        await api('post', '/api/reservations', ens1Token, { salle_id: ids.salleB, creneau_id: ids.d1216, groupe_id: ids.g1, evenement_id: ids.cours });
        const s = (await pool.query('SELECT id FROM seance WHERE edt_id = $1', [ids.s1])).rows[0];
        await api('post', '/api/demandes-changement', ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14' });

        const res = await api('get', `${U}/${ids.ens1}`, adminToken);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: ids.ens1, nom: 'Alami', prenom: 'Test', email: 'ens1@test.ma', role: 'enseignant', actif: true });
        expect(res.body.activite_en_cours).toEqual({ seances_a_venir: 1, reservations_a_venir: 2, demandes_en_attente: 1 });
        expect(JSON.stringify(res.body)).not.toMatch(/mot_de_passe/);
    });

    test('introuvable → 404 ; identifiant invalide → 400', async () => {
        expect((await api('get', `${U}/99999`, adminToken)).status).toBe(404);
        expect((await api('get', `${U}/abc`, adminToken)).status).toBe(400);
        expect((await api('get', `${U}/0`, adminToken)).status).toBe(400);
    });
});

// ============================================================
describe('Comptes - création par l’admin', () => {
    test('enseignant par défaut ; le compte peut se connecter, le mot de passe est haché', async () => {
        const res = await api('post', U, adminToken, { nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma', mot_de_passe: 'secret123' });
        expect(res.status).toBe(201);
        expect(res.body.user).toEqual({ id: expect.any(Number), nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma', role: 'enseignant', actif: true });
        const ligne = await ligneBase(res.body.user.id);
        expect(ligne.mot_de_passe).toMatch(/^\$2[aby]\$/);
        expect(ligne.mot_de_passe).not.toContain('secret123');
        expect((await connexion('claire@test.ma', 'secret123')).status).toBe(200);
        expect((await connexion('claire@test.ma', 'autre-mot-de-passe')).status).toBe(401);
    });

    test('création d’un administrateur', async () => {
        const u = await creer({ role: 'admin', email: 'nouvel.admin@test.ma' });
        expect(u.role).toBe('admin');
        const token = (await connexion('nouvel.admin@test.ma', 'secret123')).body.token;
        expect((await api('get', U, token)).status).toBe(200);
    });

    test('les espaces autour des champs sont supprimés', async () => {
        const u = await creer({ nom: '  Dupont ', prenom: ' Claire  ', email: '  claire@test.ma ' });
        expect(u).toMatchObject({ nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma' });
    });

    test.each([
        ['nom manquant', { nom: undefined }],
        ['prénom manquant', { prenom: undefined }],
        ['email manquant', { email: undefined }],
        ['mot de passe manquant', { mot_de_passe: undefined }],
        ['nom vide', { nom: '   ' }],
        ['nom trop long (51)', { nom: 'x'.repeat(51) }],
        ['nom qui n’est pas un texte', { nom: 123 }],
        ['email sans @', { email: 'claire.test.ma' }],
        ['email sans domaine', { email: 'claire@test' }],
        ['email trop long', { email: `${'x'.repeat(100)}@t.ma` }],
        ['mot de passe de 7 caractères', { mot_de_passe: '1234567' }],
        ['mot de passe de 73 caractères', { mot_de_passe: 'x'.repeat(73) }],
        ['mot de passe qui n’est pas un texte', { mot_de_passe: 12345678 }],
        ['rôle inconnu', { role: 'superadmin' }],
    ])('%s → 400, rien n’est créé', async (_n, o) => {
        const avant = await nombre('utilisateur');
        expect((await api('post', U, adminToken, corps(o))).status).toBe(400);
        expect(await nombre('utilisateur')).toBe(avant);
        expect(await histo('&action=utilisateur.cree')).toEqual([]);
    });

    test('mot de passe de 8 et de 72 caractères acceptés', async () => {
        expect((await api('post', U, adminToken, corps({ mot_de_passe: '12345678' }))).status).toBe(201);
        expect((await api('post', U, adminToken, corps({ email: 'b@test.ma', mot_de_passe: 'x'.repeat(72) }))).status).toBe(201);
    });

    test('email déjà utilisé → 409, rien n’est créé ni journalisé', async () => {
        const avant = await nombre('utilisateur');
        const res = await api('post', U, adminToken, corps({ email: 'ens1@test.ma' }));
        expect(res.status).toBe(409);
        expect(await nombre('utilisateur')).toBe(avant);
        expect(await histo('&action=utilisateur.cree')).toEqual([]);
    });

    test('la création est journalisée (auteur : l’admin), sans mot de passe', async () => {
        const u = await creer();
        const e = (await histo('&action=utilisateur.cree'))[0];
        expect(e).toMatchObject({ entite_concernee: 'utilisateur', id_entite: u.id, utilisateur_id: ids.admin, utilisateur_nom: 'Admin', ancienne_valeur: null });
        expect(valeur(e)).toEqual({ id: u.id, nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma', role: 'enseignant', actif: true });
        expect(e.nouvelle_valeur).not.toMatch(/secret123|mot_de_passe|\$2[aby]\$/);
    });
});

// ============================================================
describe('Comptes - modification', () => {
    test('modifier le nom : seul le champ changé est journalisé', async () => {
        const res = await api('put', `${U}/${ids.ens1}`, adminToken, { nom: 'Alaoui' });
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ id: ids.ens1, nom: 'Alaoui', prenom: 'Test', role: 'enseignant' });
        const modifs = await histo('&action=utilisateur.modifie');
        expect(modifs).toHaveLength(1);
        expect(modifs[0]).toMatchObject({ id_entite: ids.ens1, utilisateur_id: ids.admin });
        expect(valeur(modifs[0], 'ancienne_valeur')).toEqual({ nom: 'Alami' });
        expect(valeur(modifs[0])).toEqual({ nom: 'Alaoui' });
        expect(await histo('&action=utilisateur.role_modifie')).toEqual([]);
    });

    test('modifier plusieurs champs en une fois', async () => {
        await api('put', `${U}/${ids.ens1}`, adminToken, { nom: 'Alaoui', prenom: 'Karim', email: 'karim@test.ma' });
        const e = (await histo('&action=utilisateur.modifie'))[0];
        expect(valeur(e, 'ancienne_valeur')).toEqual({ nom: 'Alami', prenom: 'Test', email: 'ens1@test.ma' });
        expect(valeur(e)).toEqual({ nom: 'Alaoui', prenom: 'Karim', email: 'karim@test.ma' });
        expect((await connexion('karim@test.ma', 'hash')).status).toBe(401); // le compte répond sous son nouvel email
    });

    test('le changement de rôle est une ligne d’historique à part', async () => {
        const res = await api('put', `${U}/${ids.ens1}`, adminToken, { role: 'admin' });
        expect(res.status).toBe(200);
        const r = await histo('&action=utilisateur.role_modifie');
        expect(r).toHaveLength(1);
        expect(valeur(r[0], 'ancienne_valeur')).toEqual({ role: 'enseignant' });
        expect(valeur(r[0])).toEqual({ role: 'admin' });
        expect(await histo('&action=utilisateur.modifie')).toEqual([]);
    });

    test('rôle et nom en même temps : deux lignes, chacune avec son sujet', async () => {
        await api('put', `${U}/${ids.ens1}`, adminToken, { role: 'admin', nom: 'Alaoui' });
        expect(valeur((await histo('&action=utilisateur.role_modifie'))[0])).toEqual({ role: 'admin' });
        expect(valeur((await histo('&action=utilisateur.modifie'))[0])).toEqual({ nom: 'Alaoui' });
    });

    test('un admin peut en rétrograder un autre tant qu’il reste lui-même administrateur', async () => {
        expect((await api('put', `${U}/${ids.admin2}`, adminToken, { role: 'enseignant' })).status).toBe(200);
    });

    test('on ne peut pas modifier son propre rôle → 409', async () => {
        const res = await api('put', `${U}/${ids.admin}`, adminToken, { role: 'enseignant' });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/propre rôle/);
        expect((await ligneBase(ids.admin)).role).toBe('admin');
    });

    test('on peut modifier son propre nom', async () => {
        expect((await api('put', `${U}/${ids.admin}`, adminToken, { nom: 'Administrateur' })).status).toBe(200);
    });

    test('email déjà pris → 409 ; son propre email inchangé → pas une erreur', async () => {
        expect((await api('put', `${U}/${ids.ens1}`, adminToken, { email: 'ens2@test.ma' })).status).toBe(409);
        const res = await api('put', `${U}/${ids.ens1}`, adminToken, { email: 'ens1@test.ma', nom: 'Alaoui' });
        expect(res.status).toBe(200);
    });

    test('rien de nouveau → 400', async () => {
        const res = await api('put', `${U}/${ids.ens1}`, adminToken, { nom: 'Alami', role: 'enseignant' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Aucun changement/);
        expect(await histo('&entite=utilisateur')).toEqual([]);
    });

    test.each([
        ['corps vide', {}],
        ['nom vide', { nom: ' ' }],
        ['email invalide', { email: 'pas-un-email' }],
        ['rôle invalide', { role: 'chef' }],
        ['mot de passe (route dédiée)', { mot_de_passe: 'nouveau-mot-de-passe' }],
    ])('%s → 400', async (_n, body) => {
        expect((await api('put', `${U}/${ids.ens1}`, adminToken, body)).status).toBe(400);
    });

    test('le mot de passe ne se modifie pas par cette route', async () => {
        const avant = (await ligneBase(ids.ens1)).mot_de_passe;
        await api('put', `${U}/${ids.ens1}`, adminToken, { nom: 'Alaoui', mot_de_passe: 'nouveau-mot-de-passe' });
        expect((await ligneBase(ids.ens1)).mot_de_passe).toBe(avant);
    });

    test('compte inexistant → 404 ; identifiant invalide → 400', async () => {
        expect((await api('put', `${U}/99999`, adminToken, { nom: 'X' })).status).toBe(404);
        expect((await api('put', `${U}/abc`, adminToken, { nom: 'X' })).status).toBe(400);
    });
});

// ============================================================
describe('Comptes - désactivation et réactivation', () => {
    const MOT_DE_PASSE = 'secret123';

    test('désactiver : le compte ne peut plus se connecter, son token cesse de fonctionner immédiatement', async () => {
        const u = await creer({ email: 'claire@test.ma' });
        const token = (await connexion('claire@test.ma', MOT_DE_PASSE)).body.token;
        expect((await api('get', '/api/notifications', token)).status).toBe(200);

        const res = await api('put', `${U}/${u.id}/desactiver`, adminToken);
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ id: u.id, actif: false });

        const refus = await connexion('claire@test.ma', MOT_DE_PASSE);
        expect(refus.status).toBe(403);
        expect(refus.body.message).toMatch(/désactivé/);
        const ancien = await api('get', '/api/notifications', token);
        expect(ancien.status).toBe(401);
        expect(ancien.body.message).toMatch(/désactivé/);
    });

    test('un mauvais mot de passe sur un compte désactivé reste un simple 401 (rien n’est révélé)', async () => {
        const u = await creer();
        await api('put', `${U}/${u.id}/desactiver`, adminToken);
        expect((await connexion('claire@test.ma', 'faux-mot-de-passe')).status).toBe(401);
    });

    test('la réponse indique ce qui reste à traiter pour cette personne', async () => {
        await creerSeance();
        const r = await api('post', '/api/reservations', ens1Token, { salle_id: ids.salleB, creneau_id: ids.d1215, groupe_id: ids.g1, evenement_id: ids.cours });
        await api('post', '/api/reservations', ens1Token, { salle_id: ids.salleB, creneau_id: ids.d1216, groupe_id: ids.g1, evenement_id: ids.cours });
        await api('put', `/api/reservations/${r.body.reservation.id}/traiter`, adminToken, { statut: 'confirmee' });

        const res = await api('put', `${U}/${ids.ens1}/desactiver`, adminToken);
        expect(res.status).toBe(200);
        expect(res.body.impact).toEqual({ seances_a_venir: 1, reservations_a_venir: 2, demandes_en_attente: 0 });
    });

    test('rien n’est supprimé : séances, réservations et historique de la personne restent', async () => {
        await creerSeance();
        await api('post', '/api/reservations', ens1Token, { salle_id: ids.salleB, creneau_id: ids.d1215, groupe_id: ids.g1, evenement_id: ids.cours });
        const traces = (await histo(`&utilisateur_id=${ids.ens1}`)).length;
        await api('put', `${U}/${ids.ens1}/desactiver`, adminToken);
        expect(await nombre('seance')).toBe(1);
        expect(await nombre('reservation')).toBe(1);
        expect((await histo(`&utilisateur_id=${ids.ens1}`)).length).toBe(traces);
    });

    test('c’est journalisé, avec l’impact, et la tentative de connexion refusée aussi', async () => {
        await api('put', `${U}/${ids.ens1}/desactiver`, adminToken);
        const d = (await histo('&action=utilisateur.desactive'))[0];
        expect(d).toMatchObject({ id_entite: ids.ens1, utilisateur_id: ids.admin });
        expect(valeur(d, 'ancienne_valeur')).toEqual({ actif: true });
        expect(valeur(d)).toEqual({ actif: false, seances_a_venir: 0, reservations_a_venir: 0, demandes_en_attente: 0 });

        expect((await connexion('ens1@test.ma', 'hash')).status).toBe(401); // le hash de test n'est pas un vrai mot de passe
        const vrai = await creer();
        await api('put', `${U}/${vrai.id}/desactiver`, adminToken);
        await connexion('claire@test.ma', MOT_DE_PASSE);
        expect(await histo('&action=utilisateur.connexion_refusee')).toEqual([
            expect.objectContaining({ id_entite: vrai.id, utilisateur_id: vrai.id }),
        ]);
    });

    test('un enseignant désactivé ne peut plus recevoir de séance', async () => {
        await api('put', `${U}/${ids.ens2}/desactiver`, adminToken);
        const res = await api('post', `/api/edts/${ids.s1}/seances`, adminToken, {
            enseignant_id: ids.ens2, module_id: ids.m1, salle_id: ids.salleA, creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1],
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/désactivé/);
    });

    test('on ne peut pas désactiver son propre compte → 409', async () => {
        const res = await api('put', `${U}/${ids.admin}/desactiver`, adminToken);
        expect(res.status).toBe(409);
        expect((await ligneBase(ids.admin)).actif).toBe(true);
    });

    test('déjà désactivé → 400 ; inexistant → 404 ; identifiant invalide → 400 ; rien n’est journalisé', async () => {
        await api('put', `${U}/${ids.ens1}/desactiver`, adminToken);
        const avant = (await histo()).length;
        expect((await api('put', `${U}/${ids.ens1}/desactiver`, adminToken)).status).toBe(400);
        expect((await api('put', `${U}/99999/desactiver`, adminToken)).status).toBe(404);
        expect((await api('put', `${U}/abc/desactiver`, adminToken)).status).toBe(400);
        expect((await histo()).length).toBe(avant);
    });

    test('réactiver : la personne peut se reconnecter et son ancien token refonctionne', async () => {
        const u = await creer();
        const token = (await connexion('claire@test.ma', MOT_DE_PASSE)).body.token;
        await api('put', `${U}/${u.id}/desactiver`, adminToken);
        const res = await api('put', `${U}/${u.id}/reactiver`, adminToken);
        expect(res.status).toBe(200);
        expect(res.body.user.actif).toBe(true);
        expect((await connexion('claire@test.ma', MOT_DE_PASSE)).status).toBe(200);
        expect((await api('get', '/api/notifications', token)).status).toBe(200);
        const e = (await histo('&action=utilisateur.reactive'))[0];
        expect(e).toMatchObject({ id_entite: u.id, utilisateur_id: ids.admin });
        expect(valeur(e, 'ancienne_valeur')).toEqual({ actif: false });
        expect(valeur(e)).toEqual({ actif: true });
    });

    test('réactiver un compte déjà actif → 400 ; inexistant → 404', async () => {
        expect((await api('put', `${U}/${ids.ens1}/reactiver`, adminToken)).status).toBe(400);
        expect((await api('put', `${U}/99999/reactiver`, adminToken)).status).toBe(404);
    });

    test('un compte désactivé est exclu du filtre « actifs » mais reste consultable', async () => {
        await api('put', `${U}/${ids.ens1}/desactiver`, adminToken);
        expect((await api('get', `${U}/${ids.ens1}`, adminToken)).body.actif).toBe(false);
    });
});

// ============================================================
describe('Comptes - toujours un administrateur actif', () => {
    test('deux admins qui se désactivent en même temps : un seul réussit', async () => {
        for (let essai = 0; essai < 4; essai++) {
            await pool.query("UPDATE utilisateur SET actif = TRUE WHERE role = 'admin'");
            const [a, b] = await Promise.all([
                api('put', `${U}/${ids.admin2}/desactiver`, adminToken),
                api('put', `${U}/${ids.admin}/desactiver`, admin2Token),
            ]);
            const statuts = [a.status, b.status].sort();
            expect(statuts).toEqual([200, 409]);
            const actifs = (await pool.query("SELECT COUNT(*) FROM utilisateur WHERE role = 'admin' AND actif")).rows[0].count;
            expect(Number(actifs)).toBe(1);
        }
    });

    test('désactiver un autre admin reste possible tant qu’on est actif soi-même', async () => {
        expect((await api('put', `${U}/${ids.admin2}/desactiver`, adminToken)).status).toBe(200);
        expect((await api('get', U, admin2Token)).status).toBe(401);
    });
});

// ============================================================
describe('Comptes - le rôle vient de la base, pas du token', () => {
    test('un enseignant promu administrateur a accès immédiatement, avec son ancien token', async () => {
        expect((await api('get', U, ens1Token)).status).toBe(403);
        await api('put', `${U}/${ids.ens1}`, adminToken, { role: 'admin' });
        expect((await api('get', U, ens1Token)).status).toBe(200);
    });

    test('un administrateur rétrogradé perd l’accès immédiatement', async () => {
        expect((await api('get', U, admin2Token)).status).toBe(200);
        await api('put', `${U}/${ids.admin2}`, adminToken, { role: 'enseignant' });
        expect((await api('get', U, admin2Token)).status).toBe(403);
    });

    test('un token falsifié (rôle admin, signature valide) n’ouvre aucun accès : seule la base compte', async () => {
        const faux = jwt.sign({ id: ids.ens1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        expect((await api('get', U, faux)).status).toBe(403);
    });

    test('un token d’un compte qui n’existe plus → 401', async () => {
        await pool.query('DELETE FROM utilisateur WHERE id = $1', [ids.admin2]);
        const res = await api('get', U, admin2Token);
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/introuvable/);
    });

    test('le profil renvoie les informations de la base (jamais le mot de passe)', async () => {
        const res = await api('get', '/api/auth/profil', ens1Token);
        expect(res.status).toBe(200);
        expect(res.body.utilisateur).toEqual({ id: ids.ens1, nom: 'Alami', prenom: 'Test', email: 'ens1@test.ma', role: 'enseignant', actif: true });
    });
});

// ============================================================
describe('Comptes - réinitialisation du mot de passe', () => {
    test('l’ancien mot de passe ne marche plus, le nouveau oui', async () => {
        const u = await creer();
        const res = await api('put', `${U}/${u.id}/mot-de-passe`, adminToken, { mot_de_passe: 'tout-nouveau-mdp' });
        expect(res.status).toBe(200);
        expect((await connexion('claire@test.ma', 'secret123')).status).toBe(401);
        expect((await connexion('claire@test.ma', 'tout-nouveau-mdp')).status).toBe(200);
        expect((await ligneBase(u.id)).mot_de_passe).toMatch(/^\$2[aby]\$/);
    });

    test('c’est journalisé, sans aucun mot de passe', async () => {
        const u = await creer();
        await api('put', `${U}/${u.id}/mot-de-passe`, adminToken, { mot_de_passe: 'tout-nouveau-mdp' });
        const e = (await histo('&action=utilisateur.mot_de_passe_reinitialise'))[0];
        expect(e).toMatchObject({ id_entite: u.id, utilisateur_id: ids.admin, ancienne_valeur: null, nouvelle_valeur: null });
    });

    test('un compte désactivé peut avoir son mot de passe réinitialisé', async () => {
        await api('put', `${U}/${ids.ens1}/desactiver`, adminToken);
        expect((await api('put', `${U}/${ids.ens1}/mot-de-passe`, adminToken, { mot_de_passe: 'tout-nouveau-mdp' })).status).toBe(200);
    });

    test.each([['absent', undefined], ['7 caractères', '1234567'], ['73 caractères', 'x'.repeat(73)], ['pas un texte', 12345678]])(
        'mot de passe %s → 400, rien ne change', async (_n, mdp) => {
            const avant = (await ligneBase(ids.ens1)).mot_de_passe;
            expect((await api('put', `${U}/${ids.ens1}/mot-de-passe`, adminToken, { mot_de_passe: mdp })).status).toBe(400);
            expect((await ligneBase(ids.ens1)).mot_de_passe).toBe(avant);
            expect(await histo('&action=utilisateur.mot_de_passe_reinitialise')).toEqual([]);
        });

    test('compte inexistant → 404 ; identifiant invalide → 400', async () => {
        expect((await api('put', `${U}/99999/mot-de-passe`, adminToken, { mot_de_passe: 'tout-nouveau-mdp' })).status).toBe(404);
        expect((await api('put', `${U}/abc/mot-de-passe`, adminToken, { mot_de_passe: 'tout-nouveau-mdp' })).status).toBe(400);
    });
});

// ============================================================
describe('Inscription publique', () => {
    const inscrire = (o = {}) => request(app).post('/api/auth/register').send(corps(o));

    test('le rôle envoyé par le client est ignoré : on ne peut pas se créer un compte admin', async () => {
        const res = await inscrire({ role: 'admin' });
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe('enseignant');
        expect((await ligneBase(res.body.user.id)).role).toBe('enseignant');
        const token = (await connexion('claire@test.ma', 'secret123')).body.token;
        expect((await api('get', U, token)).status).toBe(403);
    });

    test.each([
        ['nom manquant', { nom: undefined }],
        ['email invalide', { email: 'pas-un-email' }],
        ['mot de passe trop court', { mot_de_passe: '1234567' }],
        ['mot de passe trop long', { mot_de_passe: 'x'.repeat(73) }],
    ])('%s → 400', async (_n, o) => {
        const avant = await nombre('utilisateur');
        expect((await inscrire(o)).status).toBe(400);
        expect(await nombre('utilisateur')).toBe(avant);
    });

    test('email déjà utilisé → 400', async () => {
        await inscrire();
        expect((await inscrire()).status).toBe(400);
    });

    test('INSCRIPTION_PUBLIQUE=false ferme l’inscription (403), seule la gestion des comptes crée des comptes', async () => {
        process.env.INSCRIPTION_PUBLIQUE = 'false';
        try {
            const avant = await nombre('utilisateur');
            const res = await inscrire();
            expect(res.status).toBe(403);
            expect(res.body.message).toMatch(/administrateur/);
            expect(await nombre('utilisateur')).toBe(avant);
            expect((await api('post', U, adminToken, corps())).status).toBe(201);
        } finally {
            delete process.env.INSCRIPTION_PUBLIQUE;
        }
    });
});

// ============================================================
describe('Comptes - cohérence avec l’historique', () => {
    test('aucun mot de passe ni hash dans tout l’historique après toutes les opérations', async () => {
        const u = await creer({ mot_de_passe: 'secret-unique-123' });
        await api('put', `${U}/${u.id}`, adminToken, { nom: 'Autre', role: 'admin' });
        await api('put', `${U}/${u.id}/mot-de-passe`, adminToken, { mot_de_passe: 'autre-secret-456' });
        await request(app).post('/api/auth/register').send(corps({ email: 'z@test.ma', mot_de_passe: 'secret-public-789' }));
        await connexion('claire@test.ma', 'faux');
        const tout = JSON.stringify(await histo());
        expect(tout).not.toMatch(/secret-unique-123|autre-secret-456|secret-public-789|mot_de_passe"|\$2[aby]\$/);
        expect((await histo()).length).toBeGreaterThanOrEqual(5);
    });

    describe('si l’historique ne marche plus : aucune opération sur un compte n’est enregistrée', () => {
        let erreurs;
        beforeEach(() => { erreurs = jest.spyOn(console, 'error').mockImplementation(() => {}); });
        afterEach(async () => {
            erreurs.mockRestore();
            await pool.query('ALTER TABLE IF EXISTS historique_x RENAME TO historique');
        });
        const casser = () => pool.query('ALTER TABLE historique RENAME TO historique_x');

        test('création : le compte n’est pas créé', async () => {
            await casser();
            const avant = await nombre('utilisateur');
            expect((await api('post', U, adminToken, corps())).status).toBe(500);
            expect(await nombre('utilisateur')).toBe(avant);
        });

        test('modification : le compte n’est pas modifié', async () => {
            await casser();
            expect((await api('put', `${U}/${ids.ens1}`, adminToken, { nom: 'Alaoui', role: 'admin' })).status).toBe(500);
            expect(await ligneBase(ids.ens1)).toMatchObject({ nom: 'Alami', role: 'enseignant' });
        });

        test('désactivation : le compte reste actif', async () => {
            await casser();
            expect((await api('put', `${U}/${ids.ens1}/desactiver`, adminToken)).status).toBe(500);
            expect((await ligneBase(ids.ens1)).actif).toBe(true);
        });

        test('réinitialisation du mot de passe : l’ancien mot de passe est conservé', async () => {
            await casser();
            const avant = (await ligneBase(ids.ens1)).mot_de_passe;
            expect((await api('put', `${U}/${ids.ens1}/mot-de-passe`, adminToken, { mot_de_passe: 'tout-nouveau-mdp' })).status).toBe(500);
            expect((await ligneBase(ids.ens1)).mot_de_passe).toBe(avant);
        });
    });
});
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
const histo = async (qs = '') => (await api('get', `/api/historique${qs}`, adminToken)).body;
const entrees = async (qs = '') => (await histo(`${qs}${qs.includes('?') ? '&' : '?'}limit=200`)).resultats;
const valeur = (entree, cote = 'nouvelle_valeur') => (entree[cote] === null ? null : JSON.parse(entree[cote]));
const unique = async (action, qs = '') => {
    const liste = await entrees(`?action=${action}${qs}`);
    expect(liste).toHaveLength(1);
    return liste[0];
};
const nombre = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count);

const reserver = (token, o = {}) => api('post', '/api/reservations', token, {
    salle_id: ids.salleA, creneau_id: ids.d1215, groupe_id: ids.g1, evenement_id: ids.cours, ...o,
});
const creerResa = async (token, o) => { const r = await reserver(token, o); expect(r.status).toBe(201); return r.body.reservation; };
const traiterResa = (id, body) => api('put', `/api/reservations/${id}/traiter`, adminToken, body);
const corpsSeance = (o = {}) => ({
    enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
    creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1], ...o,
});
const creerSeance = async (o) => {
    const r = await api('post', `/api/edts/${ids.s1}/seances`, adminToken, corpsSeance(o));
    expect(r.status).toBe(201);
    return r.body.seance;
};
const demander = (token, body) => api('post', '/api/demandes-changement', token, body);
const creerDemande = async (token, body) => { const r = await demander(token, body); expect(r.status).toBe(201); return r.body.demande; };
const traiterDemande = (id, body) => api('put', `/api/demandes-changement/${id}/traiter`, adminToken, body);
const ponctuel = (s, o = {}) => ({ type_demande: 'deplacement_ponctuel', seance_id: s.id, date_occurrence: '2026-12-14', ...o });

// ============================================================
describe('Historique - accès et paramètres', () => {
    test('sans token → 401', async () => {
        expect((await request(app).get('/api/historique')).status).toBe(401);
    });
    test('un enseignant → 403', async () => {
        expect((await api('get', '/api/historique', ens1Token)).status).toBe(403);
    });
    test('historique vide au départ', async () => {
        expect(await histo()).toEqual({ total: 0, limit: 50, offset: 0, resultats: [] });
    });
    test.each([
        ['limit=0'], ['limit=201'], ['limit=abc'], ['offset=-1'], ['offset=abc'],
        ['id_entite=abc'], ['utilisateur_id=abc'], ['depuis=2026-02-30'], ['jusqua=abc'],
        [`entite=${'x'.repeat(51)}`], [`action=${'x'.repeat(51)}`],
    ])('paramètre invalide (%s) → 400', async (qs) => {
        expect((await api('get', `/api/historique?${qs}`, adminToken)).status).toBe(400);
    });
});

// ============================================================
describe('Historique - données de référence', () => {
    const REFERENTIEL = [
        ['niveau', '/api/niveaux', () => ({ libelle: 'Master', code_niveau: 'M1' }), 'libelle', 'Master', 'niveau.cree', 'niveau.supprime'],
        ['filiere', '/api/filieres', () => ({ nom_filiere: 'Électronique', code_filiere: 'EL', niveau_id: ids.niveau }), 'nom_filiere', 'Électronique', 'filiere.creee', 'filiere.supprimee'],
        ['groupe', '/api/groupes', () => ({ nom_groupe: 'G9', effectif: 25, filiere_id: ids.f1 }), 'nom_groupe', 'G9', 'groupe.cree', 'groupe.supprime'],
        ['module', '/api/modules', () => ({ nom_module: 'Réseaux', code_module: 'RES' }), 'nom_module', 'Réseaux', 'module.cree', 'module.supprime'],
        ['evenement', '/api/evenements', () => ({ libelle: 'Travaux pratiques' }), 'libelle', 'Travaux pratiques', 'evenement.cree', 'evenement.supprime'],
        ['creneau', '/api/creneaux', () => ({ jour: 'vendredi', heure_debut: '14:00', heure_fin: '16:00' }), 'jour', 'vendredi', 'creneau.cree', 'creneau.supprime'],
        ['salle', '/api/salles', () => ({ nom_salle: 'Labo 1', capacite: 30, type_salle: 'salle_td', etat: 'disponible' }), 'nom_salle', 'Labo 1', 'salle.creee', 'salle.supprimee'],
    ];

    test.each(REFERENTIEL)('%s : création et suppression sont journalisées', async (entite, chemin, corps, champ, val, actionCree, actionSupprime) => {
        const cree = await api('post', chemin, adminToken, corps());
        expect(cree.status).toBe(201);

        const c = await unique(actionCree);
        expect(c).toMatchObject({ entite_concernee: entite, utilisateur_id: ids.admin, utilisateur_nom: 'Admin', ancienne_valeur: null });
        expect(Number.isInteger(c.id_entite)).toBe(true);
        expect(valeur(c)[champ]).toBe(val);
        expect(valeur(c).id).toBe(c.id_entite);
        expect(c.date_action).toBeTruthy();

        const suppr = await api('delete', `${chemin}/${c.id_entite}`, adminToken);
        expect(suppr.status).toBe(200);
        const s = await unique(actionSupprime);
        expect(s).toMatchObject({ entite_concernee: entite, id_entite: c.id_entite, utilisateur_id: ids.admin, nouvelle_valeur: null });
        expect(valeur(s, 'ancienne_valeur')[champ]).toBe(val);
    });

    test.each(REFERENTIEL)('%s : une création refusée (400) ou un enseignant (403) ne laisse aucune trace', async (_e, chemin, corps) => {
        expect((await api('post', chemin, adminToken, {})).status).toBe(400);
        expect((await api('post', chemin, ens1Token, corps())).status).toBe(403);
        expect(await nombre('historique')).toBe(0);
    });

    test.each(REFERENTIEL)('%s : supprimer un élément inexistant (404) ne laisse aucune trace', async (_e, chemin) => {
        expect((await api('delete', `${chemin}/99999`, adminToken)).status).toBe(404);
        expect(await nombre('historique')).toBe(0);
    });

    test('salle : la modification garde l’ancienne et la nouvelle valeur', async () => {
        const res = await api('put', `/api/salles/${ids.salleA}`, adminToken, { nom_salle: 'Salle A bis', capacite: 45, type_salle: 'salle_td', etat: 'disponible' });
        expect(res.status).toBe(200);
        const e = await unique('salle.modifiee');
        expect(e).toMatchObject({ entite_concernee: 'salle', id_entite: ids.salleA, utilisateur_id: ids.admin });
        expect(valeur(e, 'ancienne_valeur')).toEqual({ nom_salle: 'Salle A', capacite: 40, type_salle: 'salle_td', etat: 'disponible' });
        expect(valeur(e)).toEqual({ nom_salle: 'Salle A bis', capacite: 45, type_salle: 'salle_td', etat: 'disponible' });
    });

    test('équipement : création, modification et suppression', async () => {
        const base = `/api/salles/${ids.salleA}/equipements`;
        expect((await api('post', base, adminToken, { nom_equipement: 'Projecteur' })).status).toBe(201);
        const c = await unique('equipement.cree');
        expect(valeur(c)).toMatchObject({ nom_equipement: 'Projecteur', salle_id: ids.salleA });

        expect((await api('put', `${base}/${c.id_entite}`, adminToken, { nom_equipement: 'Écran' })).status).toBe(200);
        const m = await unique('equipement.modifie');
        expect(valeur(m, 'ancienne_valeur').nom_equipement).toBe('Projecteur');
        expect(valeur(m).nom_equipement).toBe('Écran');

        expect((await api('delete', `${base}/${c.id_entite}`, adminToken)).status).toBe(200);
        expect(valeur(await unique('equipement.supprime'), 'ancienne_valeur').nom_equipement).toBe('Écran');
    });
});

// ============================================================
describe('Historique - authentification', () => {
    const inscrire = () => request(app).post('/api/auth/register').send({
        nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma', mot_de_passe: 'secret123',
    });

    test('inscription journalisée, sans jamais enregistrer le mot de passe', async () => {
        const res = await inscrire();
        expect(res.status).toBe(201);
        const e = await unique('utilisateur.inscrit');
        expect(e).toMatchObject({ entite_concernee: 'utilisateur', id_entite: res.body.user.id, utilisateur_id: res.body.user.id });
        expect(valeur(e)).toEqual({ id: res.body.user.id, nom: 'Dupont', prenom: 'Claire', email: 'claire@test.ma', role: 'enseignant' });
        expect(e.nouvelle_valeur).not.toMatch(/secret123|mot_de_passe|\$2[aby]\$/);
    });

    test('connexion réussie et mot de passe erroné (compte existant) sont journalisés', async () => {
        const u = (await inscrire()).body.user;
        expect((await request(app).post('/api/auth/login').send({ email: 'claire@test.ma', mot_de_passe: 'faux' })).status).toBe(401);
        expect((await request(app).post('/api/auth/login').send({ email: 'claire@test.ma', mot_de_passe: 'secret123' })).status).toBe(200);
        expect(await unique('utilisateur.echec_connexion')).toMatchObject({ id_entite: u.id, utilisateur_id: u.id });
        expect(await unique('utilisateur.connexion')).toMatchObject({ id_entite: u.id, utilisateur_id: u.id });
    });

    test('email inconnu ou inscription refusée : aucune trace (pas d’utilisateur à qui l’attribuer)', async () => {
        await inscrire();
        const avant = await nombre('historique');
        expect((await request(app).post('/api/auth/login').send({ email: 'inconnu@test.ma', mot_de_passe: 'x' })).status).toBe(401);
        expect((await inscrire()).status).toBe(400); // email déjà utilisé
        expect(await nombre('historique')).toBe(avant);
    });
});

// ============================================================
describe('Historique - EDT et séances', () => {
    test('création d’un EDT', async () => {
        const res = await api('post', '/api/edts', adminToken, {
            titre: 'S3 GI', annee_universitaire: '2026-2027', semestre: 'S3', date_debut: '2027-01-05', date_fin: '2027-06-30', filiere_id: ids.f1,
        });
        expect(res.status).toBe(201);
        const e = await unique('edt.cree');
        expect(e).toMatchObject({ entite_concernee: 'edt', utilisateur_id: ids.admin });
        expect(valeur(e)).toMatchObject({ titre: 'S3 GI', date_debut: '2027-01-05' });
    });

    test('suppression d’un EDT : la trace liste les séances emportées', async () => {
        const a = await creerSeance();
        const b = await creerSeance({ creneau_id: ids.mar8 });
        expect((await api('delete', `/api/edts/${ids.s1}`, adminToken)).status).toBe(200);
        const e = await unique('edt.supprime');
        expect(e.id_entite).toBe(ids.s1);
        expect(valeur(e, 'ancienne_valeur')).toMatchObject({ titre: 'S1 GI', seances_supprimees: [a.id, b.id] });
    });

    test('séance : création, modification et suppression avec l’état avant/après', async () => {
        const s = await creerSeance();
        const c = await unique('seance.creee');
        expect(c).toMatchObject({ entite_concernee: 'seance', id_entite: s.id, utilisateur_id: ids.admin, ancienne_valeur: null });
        expect(valeur(c)).toEqual({
            edt_id: ids.s1, enseignant_id: ids.ens1, module_id: ids.m1, salle_id: ids.salleA,
            creneau_id: ids.lun8, evenement_id: ids.cours, groupe_ids: [ids.g1],
        });

        const maj = await api('put', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken, corpsSeance({ salle_id: ids.salleB, groupe_ids: [ids.g2] }));
        expect(maj.status).toBe(200);
        const m = await unique('seance.modifiee');
        expect(valeur(m, 'ancienne_valeur')).toMatchObject({ salle_id: ids.salleA, groupe_ids: [ids.g1] });
        expect(valeur(m)).toMatchObject({ salle_id: ids.salleB, groupe_ids: [ids.g2] });

        expect((await api('delete', `/api/edts/${ids.s1}/seances/${s.id}`, adminToken)).status).toBe(200);
        const d = await unique('seance.supprimee');
        expect(d).toMatchObject({ id_entite: s.id, nouvelle_valeur: null });
        expect(valeur(d, 'ancienne_valeur')).toMatchObject({ salle_id: ids.salleB, groupe_ids: [ids.g2] });
    });

    test('une séance refusée (conflit, 409) ou invalide (400) ne laisse aucune trace', async () => {
        await creerSeance();
        const avant = await nombre('historique');
        expect((await api('post', `/api/edts/${ids.s1}/seances`, adminToken, corpsSeance({ enseignant_id: ids.ens2, groupe_ids: [ids.g2] }))).status).toBe(409);
        expect((await api('post', `/api/edts/${ids.s1}/seances`, adminToken, {})).status).toBe(400);
        expect(await nombre('historique')).toBe(avant);
    });
});

// ============================================================
describe('Historique - réservations', () => {
    test('demandée → confirmée, avec l’auteur de chaque action', async () => {
        const r = await creerResa(ens1Token);
        const d = await unique('reservation.demandee');
        expect(d).toMatchObject({ entite_concernee: 'reservation', id_entite: r.id, utilisateur_id: ids.ens1, utilisateur_nom: 'Alami' });
        expect(valeur(d)).toEqual({ statut: 'en_attente', salle_id: ids.salleA, creneau_id: ids.d1215, groupe_id: ids.g1, enseignant_id: ids.ens1 });

        expect((await traiterResa(r.id, { statut: 'confirmee' })).status).toBe(200);
        const c = await unique('reservation.confirmee');
        expect(c).toMatchObject({ id_entite: r.id, utilisateur_id: ids.admin });
        expect(valeur(c, 'ancienne_valeur')).toEqual({ statut: 'en_attente' });
        expect(valeur(c)).toEqual({ statut: 'confirmee' });
    });

    test('rejetée : le motif est conservé', async () => {
        const r = await creerResa(ens1Token);
        await traiterResa(r.id, { statut: 'rejetee', motif_rejet: 'Salle réservée pour un examen' });
        const e = await unique('reservation.rejetee');
        expect(valeur(e)).toEqual({ statut: 'rejetee', motif_rejet: 'Salle réservée pour un examen' });
        expect(e.utilisateur_id).toBe(ids.admin);
    });

    test('annulée : l’ancien statut est conservé, par l’enseignant', async () => {
        const r = await creerResa(ens1Token);
        await traiterResa(r.id, { statut: 'confirmee' });
        await api('put', `/api/reservations/${r.id}/annuler`, ens1Token);
        const e = await unique('reservation.annulee');
        expect(e).toMatchObject({ id_entite: r.id, utilisateur_id: ids.ens1 });
        expect(valeur(e, 'ancienne_valeur')).toEqual({ statut: 'confirmee' });
        expect(valeur(e)).toEqual({ statut: 'annulee' });
    });

    test('réaffectée par l’admin : ancienne et nouvelle destination', async () => {
        const r = await creerResa(ens1Token);
        await api('put', `/api/reservations/${r.id}/reaffecter`, adminToken, { salle_id: ids.salleB, creneau_id: ids.d1216 });
        const e = await unique('reservation.reaffectee');
        expect(e.utilisateur_id).toBe(ids.admin);
        expect(valeur(e, 'ancienne_valeur')).toMatchObject({ statut: 'en_attente', salle_id: ids.salleA, creneau_id: ids.d1215 });
        expect(valeur(e)).toMatchObject({ statut: 'confirmee', salle_id: ids.salleB, creneau_id: ids.d1216 });
    });

    test('refus automatique : une ligne par demande refusée, attribuée à l’admin qui a accepté', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1 });
        const r2 = await creerResa(ens2Token, { groupe_id: ids.g2 });
        await traiterResa(r1.id, { statut: 'confirmee' });
        const e = await unique('reservation.refusee_auto');
        expect(e).toMatchObject({ id_entite: r2.id, utilisateur_id: ids.admin });
        expect(valeur(e)).toMatchObject({ statut: 'rejetee' });
        expect(valeur(e).motif_rejet).toMatch(/^Conflit : la place a été attribuée à la réservation n°/);
    });

    test('opérations refusées (409, 400, 403) : aucune trace', async () => {
        const r = await creerResa(ens1Token);
        await creerSeance({ enseignant_id: ids.ens2, salle_id: ids.salleA, creneau_id: ids.mar8, groupe_ids: [ids.g2] });
        const avant = await nombre('historique');
        expect((await traiterResa(r.id, { statut: 'confirmee' })).status).toBe(409);            // place prise entre-temps
        expect((await traiterResa(r.id, { statut: 'rejetee' })).status).toBe(400);              // motif manquant
        expect((await api('put', `/api/reservations/${r.id}/annuler`, ens2Token)).status).toBe(403);
        expect((await reserver(ens1Token, { salle_id: ids.maintenance })).status).toBe(409);
        expect(await nombre('historique')).toBe(avant);
    });
});

// ============================================================
describe('Historique - demandes de changement', () => {
    test('créée → acceptée (déplacement ponctuel)', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, ponctuel(s, { nouvelle_salle_id: ids.salleB }));
        const c = await unique('demande_changement.creee');
        expect(c).toMatchObject({ entite_concernee: 'demande_changement', id_entite: d.id, utilisateur_id: ids.ens1 });
        expect(valeur(c)).toEqual({ statut: 'en_attente', type_demande: 'deplacement_ponctuel', date_occurrence: '2026-12-14', nouveau_creneau_id: null, nouvelle_salle_id: ids.salleB });

        await traiterDemande(d.id, { statut: 'acceptee' });
        const a = await unique('demande_changement.acceptee');
        expect(a.utilisateur_id).toBe(ids.admin);
        expect(valeur(a, 'ancienne_valeur').statut).toBe('en_attente');
        expect(valeur(a).statut).toBe('acceptee');
    });

    test('refusée : le motif est conservé', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, { type_demande: 'annulation_ponctuelle', seance_id: s.id, date_occurrence: '2026-12-14' });
        await traiterDemande(d.id, { statut: 'refusee', motif_refus: 'Pas de remplaçant' });
        const e = await unique('demande_changement.refusee');
        expect(valeur(e)).toEqual({ statut: 'refusee', motif_refus: 'Pas de remplaçant' });
    });

    test('déplacement définitif accepté : la modification de la séance est aussi journalisée', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, { type_demande: 'deplacement_definitif', seance_id: s.id, nouveau_creneau_id: ids.mar8, nouvelle_salle_id: ids.salleB });
        await traiterDemande(d.id, { statut: 'acceptee' });
        const m = await unique('seance.modifiee');
        expect(m).toMatchObject({ id_entite: s.id, utilisateur_id: ids.admin });
        expect(valeur(m, 'ancienne_valeur')).toEqual({ creneau_id: ids.lun8, salle_id: ids.salleA });
        expect(valeur(m)).toEqual({ creneau_id: ids.mar8, salle_id: ids.salleB });
    });

    test('réaffectée par l’admin : ancienne et nouvelle destination', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        await api('put', `/api/demandes-changement/${d.id}/reaffecter`, adminToken, { nouvelle_salle_id: ids.pile });
        const e = await unique('demande_changement.reaffectee');
        expect(valeur(e, 'ancienne_valeur')).toMatchObject({ statut: 'en_attente', nouvelle_salle_id: ids.amphi });
        expect(valeur(e)).toMatchObject({ statut: 'acceptee', nouvelle_salle_id: ids.pile, nouveau_creneau_id: ids.d1215 });
    });

    test('refus automatique d’une demande de changement par une réservation confirmée', async () => {
        const s = await creerSeance();
        const r = await creerResa(ens2Token, { groupe_id: ids.g2, salle_id: ids.amphi });
        const d = await creerDemande(ens1Token, ponctuel(s, { nouveau_creneau_id: ids.d1215, nouvelle_salle_id: ids.amphi }));
        await traiterResa(r.id, { statut: 'confirmee' });
        const e = await unique('demande_changement.refusee_auto');
        expect(e).toMatchObject({ id_entite: d.id, utilisateur_id: ids.admin });
        expect(valeur(e).motif_refus).toMatch(/Conflit/);
    });

    test('demande refusée (400/403/404/409) : aucune trace', async () => {
        const s = await creerSeance();
        const avant = await nombre('historique');
        expect((await demander(ens2Token, ponctuel(s, { nouvelle_salle_id: ids.salleB }))).status).toBe(403);
        expect((await demander(ens1Token, { type_demande: 'x', seance_id: s.id })).status).toBe(400);
        expect((await demander(ens1Token, ponctuel(s, { nouvelle_salle_id: ids.maintenance }))).status).toBe(409);
        expect((await traiterDemande(9999, { statut: 'acceptee' })).status).toBe(404);
        expect(await nombre('historique')).toBe(avant);
    });
});

// ============================================================
describe('Historique - filtres, ordre et pagination', () => {
    const creerNiveaux = async (n) => {
        for (let i = 1; i <= n; i++) {
            expect((await api('post', '/api/niveaux', adminToken, { libelle: `Niveau ${i}`, code_niveau: `N${i}` })).status).toBe(201);
        }
    };

    test('les plus récentes d’abord', async () => {
        await creerNiveaux(3);
        const liste = await entrees('?entite=niveau');
        expect(liste.map((e) => valeur(e).libelle)).toEqual(['Niveau 3', 'Niveau 2', 'Niveau 1']);
    });

    test('pagination : limit, offset et total', async () => {
        await creerNiveaux(5);
        const complet = await entrees('?entite=niveau');
        const page = await histo('?entite=niveau&limit=2&offset=2');
        expect(page).toMatchObject({ total: 5, limit: 2, offset: 2 });
        expect(page.resultats.map((e) => e.id)).toEqual(complet.slice(2, 4).map((e) => e.id));
        expect((await histo('?entite=niveau&limit=2&offset=10')).resultats).toEqual([]);
    });

    test('filtres : entité, identifiant, utilisateur, action', async () => {
        const r = await creerResa(ens1Token);
        await traiterResa(r.id, { statut: 'confirmee' });
        await creerNiveaux(1);

        expect((await entrees('?entite=reservation')).map((e) => e.action).sort()).toEqual(['reservation.confirmee', 'reservation.demandee']);
        expect(await entrees(`?id_entite=${r.id}&entite=reservation`)).toHaveLength(2);
        expect((await entrees(`?utilisateur_id=${ids.ens1}`)).map((e) => e.action)).toEqual(['reservation.demandee']);
        expect((await entrees(`?utilisateur_id=${ids.admin}`)).map((e) => e.action).sort()).toEqual(['niveau.cree', 'reservation.confirmee']);
        expect(await entrees('?action=niveau.cree')).toHaveLength(1);
        expect(await entrees('?action=inconnue')).toEqual([]);
        expect((await histo('?entite=reservation&action=reservation.demandee')).total).toBe(1);
    });

    test('filtres par date', async () => {
        await creerNiveaux(2);
        const aujourdhui = (await pool.query('SELECT CURRENT_DATE::text AS d')).rows[0].d;
        expect((await histo(`?depuis=${aujourdhui}&jusqua=${aujourdhui}`)).total).toBe(2);
        expect((await histo('?depuis=2999-01-01')).total).toBe(0);
        expect((await histo('?jusqua=2000-01-01')).total).toBe(0);
    });

    test('chaque ligne contient l’auteur', async () => {
        await creerNiveaux(1);
        expect((await entrees())[0]).toMatchObject({ utilisateur_id: ids.admin, utilisateur_nom: 'Admin', utilisateur_prenom: 'Test' });
    });
});

// ============================================================
describe('Historique - cohérence avec la décision', () => {
    // Les confirmations/acceptations écrivent l'historique DANS la transaction : sans trace, pas de décision.
    // Les autres opérations écrivent "au mieux" : l'historique ne fait jamais échouer l'action.
    let erreurs;
    beforeEach(() => { erreurs = jest.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(async () => {
        erreurs.mockRestore();
        await pool.query('ALTER TABLE IF EXISTS historique_x RENAME TO historique');
    });
    const casserHistorique = () => pool.query('ALTER TABLE historique RENAME TO historique_x');

    test('confirmer une réservation : si l’historique échoue, la confirmation est annulée', async () => {
        const r = await creerResa(ens1Token);
        await casserHistorique();
        const res = await traiterResa(r.id, { statut: 'confirmee' });
        expect(res.status).toBe(500);
        expect((await pool.query('SELECT statut FROM reservation WHERE id = $1', [r.id])).rows[0].statut).toBe('en_attente');
    });

    test('refus automatique : si l’historique échoue, rien n’est confirmé ni refusé', async () => {
        const r1 = await creerResa(ens1Token, { groupe_id: ids.g1 });
        const r2 = await creerResa(ens2Token, { groupe_id: ids.g2 });
        await casserHistorique();
        expect((await traiterResa(r1.id, { statut: 'confirmee' })).status).toBe(500);
        const statuts = (await pool.query('SELECT statut FROM reservation ORDER BY id')).rows.map((x) => x.statut);
        expect(statuts).toEqual(['en_attente', 'en_attente']);
        expect(r2).toBeTruthy();
    });

    test('accepter une demande de changement définitive : si l’historique échoue, la séance ne change pas', async () => {
        const s = await creerSeance();
        const d = await creerDemande(ens1Token, { type_demande: 'deplacement_definitif', seance_id: s.id, nouveau_creneau_id: ids.mar8 });
        await casserHistorique();
        expect((await traiterDemande(d.id, { statut: 'acceptee' })).status).toBe(500);
        expect((await pool.query('SELECT creneau_id FROM seance WHERE id = $1', [s.id])).rows[0].creneau_id).toBe(ids.lun8);
        expect((await pool.query('SELECT statut FROM demande_changement WHERE id = $1', [d.id])).rows[0].statut).toBe('en_attente');
    });

    test('opérations simples : si l’historique échoue, l’opération réussit quand même', async () => {
        await casserHistorique();
        expect((await api('post', '/api/niveaux', adminToken, { libelle: 'Master', code_niveau: 'M1' })).status).toBe(201);
        expect((await reserver(ens1Token)).status).toBe(201);
        expect(erreurs).toHaveBeenCalled(); // l'erreur est signalée dans la console, sans faire échouer la requête
    });
});
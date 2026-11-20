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

// ---------- Outils ----------

// Séance par défaut : ens1, Salle A, lundi 8h-10h récurrent, groupe G1
const base = (o = {}) => ({
    enseignant_id: ids.ens1,
    module_id: ids.m1,
    salle_id: ids.salleA,
    creneau_id: ids.lun8,
    evenement_id: ids.cours,
    groupe_ids: [ids.g1],
    ...o,
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const ajouter = (edtId, body, token = adminToken) =>
    request(app).post(`/api/edts/${edtId}/seances`).set(auth(token)).send(body);
const modifier = (edtId, id, body, token = adminToken) =>
    request(app).put(`/api/edts/${edtId}/seances/${id}`).set(auth(token)).send(body);
const supprimer = (edtId, id, token = adminToken) =>
    request(app).delete(`/api/edts/${edtId}/seances/${id}`).set(auth(token));
const lister = (edtId, token = adminToken) =>
    request(app).get(`/api/edts/${edtId}/seances`).set(auth(token));

// Crée une séance en vérifiant que ça réussit (pour préparer un scénario)
const creer = async (edtId, body) => {
    const res = await ajouter(edtId, body);
    expect(res.status).toBe(201);
    return res.body.seance;
};

const compter = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count);

// ---------- Authentification et rôles ----------

describe('Séances - authentification et rôles', () => {
    test('créer sans token → 401', async () => {
        const res = await request(app).post(`/api/edts/${ids.s1}/seances`).send(base());
        expect(res.status).toBe(401);
    });

    test('lister sans token → 401', async () => {
        const res = await request(app).get(`/api/edts/${ids.s1}/seances`);
        expect(res.status).toBe(401);
    });

    test('un enseignant ne peut pas créer → 403', async () => {
        const res = await ajouter(ids.s1, base(), ensToken);
        expect(res.status).toBe(403);
        expect(await compter('seance')).toBe(0);
    });

    test('un enseignant ne peut pas modifier → 403', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base({ creneau_id: ids.mar8 }), ensToken);
        expect(res.status).toBe(403);
    });

    test('un enseignant ne peut pas supprimer → 403', async () => {
        const s = await creer(ids.s1, base());
        const res = await supprimer(ids.s1, s.id, ensToken);
        expect(res.status).toBe(403);
        expect(await compter('seance')).toBe(1);
    });

    test('un enseignant peut lister → 200', async () => {
        const res = await lister(ids.s1, ensToken);
        expect(res.status).toBe(200);
    });
});

// ---------- Création : validation du body ----------

describe('Séances - création : validation des données', () => {
    test('séance valide → 201, enregistrée avec ses groupes', async () => {
        const res = await ajouter(ids.s1, base());
        expect(res.status).toBe(201);
        expect(res.body.seance).toMatchObject({
            edt_id: ids.s1,
            enseignant_id: ids.ens1,
            salle_id: ids.salleA,
            creneau_id: ids.lun8,
            groupe_ids: [ids.g1],
        });
        expect(await compter('seance')).toBe(1);
        const sg = await pool.query('SELECT groupe_id FROM seance_groupe');
        expect(sg.rows).toEqual([{ groupe_id: ids.g1 }]);
    });

    test.each(['enseignant_id', 'module_id', 'salle_id', 'creneau_id', 'evenement_id', 'groupe_ids'])(
        'champ %s manquant → 400',
        async (champ) => {
            const body = base();
            delete body[champ];
            const res = await ajouter(ids.s1, body);
            expect(res.status).toBe(400);
            expect(await compter('seance')).toBe(0);
        }
    );

    test.each([
        ['un nombre au lieu d’un tableau', 5],
        ['une chaîne au lieu d’un tableau', '1'],
        ['un tableau vide', []],
        ['du texte dans le tableau', ['abc']],
        ['un zéro dans le tableau', [0]],
        ['un nombre négatif dans le tableau', [-1]],
    ])('groupe_ids invalide (%s) → 400', async (_nom, valeur) => {
        const res = await ajouter(ids.s1, base({ groupe_ids: valeur }));
        expect(res.status).toBe(400);
        expect(await compter('seance')).toBe(0);
    });

    test('identifiants envoyés en texte ("5") → acceptés', async () => {
        const res = await ajouter(ids.s1, base({
            enseignant_id: String(ids.ens1),
            salle_id: String(ids.salleA),
            creneau_id: String(ids.lun8),
            groupe_ids: [String(ids.g1)],
        }));
        expect(res.status).toBe(201);
    });

    test('les identifiants en texte sont bien comparés pour les conflits', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({
            salle_id: String(ids.salleA), enseignant_id: String(ids.ens2), groupe_ids: [String(ids.g2)],
        }));
        expect(res.status).toBe(409);
    });

    test('groupes en double ([g1, g1]) → dédoublonnés, une seule ligne en base', async () => {
        const res = await ajouter(ids.s1, base({ groupe_ids: [ids.g1, ids.g1] }));
        expect(res.status).toBe(201);
        expect(res.body.seance.groupe_ids).toEqual([ids.g1]);
        expect(await compter('seance_groupe')).toBe(1);
    });

    test('EDT inexistant → 404', async () => {
        const res = await ajouter(9999, base());
        expect(res.status).toBe(404);
    });

    test('identifiant d’EDT non numérique → 400', async () => {
        const res = await ajouter('abc', base());
        expect(res.status).toBe(400);
    });
});

// ---------- Création : références et règles métier ----------

describe('Séances - création : règles métier', () => {
    test('l’utilisateur est un admin, pas un enseignant → 400', async () => {
        const res = await ajouter(ids.s1, base({ enseignant_id: ids.admin }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/enseignant/i);
    });

    test('enseignant inexistant → 400', async () => {
        const res = await ajouter(ids.s1, base({ enseignant_id: 9999 }));
        expect(res.status).toBe(400);
    });

    test('salle inexistante → 400', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: 9999 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/salle/i);
    });

    test('créneau inexistant → 400', async () => {
        const res = await ajouter(ids.s1, base({ creneau_id: 9999 }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/cr[ée]neau/i);
    });

    test('groupe inexistant → 400', async () => {
        const res = await ajouter(ids.s1, base({ groupe_ids: [9999] }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/groupe/i);
    });

    test('module inexistant → 400 et rien n’est enregistré', async () => {
        const res = await ajouter(ids.s1, base({ module_id: 9999 }));
        expect(res.status).toBe(400);
        expect(await compter('seance')).toBe(0);
        expect(await compter('seance_groupe')).toBe(0);
    });

    test('événement inexistant → 400 et rien n’est enregistré', async () => {
        const res = await ajouter(ids.s1, base({ evenement_id: 9999 }));
        expect(res.status).toBe(400);
        expect(await compter('seance')).toBe(0);
    });

    test('groupe d’une autre filière que l’EDT → 400', async () => {
        const res = await ajouter(ids.s1, base({ groupe_ids: [ids.g3] }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/fili[èe]re/i);
    });

    test('un des groupes est d’une autre filière → 400', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g3] }));
        expect(res.status).toBe(400);
    });

    test('salle en maintenance → 409', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: ids.maintenance }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/maintenance/i);
    });

    test('salle indisponible → 409', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: ids.indispo }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/indisponible/i);
    });

    test('capacité insuffisante (60 étudiants, 40 places) → 400', async () => {
        const res = await ajouter(ids.s1, base({ groupe_ids: [ids.g1, ids.g2] }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/capacit/i);
    });

    test('capacité insuffisante (30 étudiants, 20 places) → 400', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: ids.petite }));
        expect(res.status).toBe(400);
    });

    test('capacité exactement égale à l’effectif (60 / 60) → 201', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: ids.pile, groupe_ids: [ids.g1, ids.g2] }));
        expect(res.status).toBe(201);
    });

    test('plusieurs groupes dans un amphi assez grand → 201, les deux groupes enregistrés', async () => {
        const res = await ajouter(ids.s1, base({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g2] }));
        expect(res.status).toBe(201);
        expect(await compter('seance_groupe')).toBe(2);
    });

    test('créneau daté hors de la période de l’EDT → 400', async () => {
        const res = await ajouter(ids.s1, base({ creneau_id: ids.dHors }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/p[ée]riode/i);
    });

    test('créneau daté dans la période de l’EDT → 201', async () => {
        const res = await ajouter(ids.s1, base({ creneau_id: ids.d1214 }));
        expect(res.status).toBe(201);
    });

    test('créneau daté le dernier jour de l’EDT inclus → 201', async () => {
        // edtB va jusqu'au 2027-01-31 ; d1221 (21 décembre) est bien dedans
        const res = await ajouter(ids.edtB, base({ creneau_id: ids.d1221, groupe_ids: [ids.g3] }));
        expect(res.status).toBe(201);
    });
});

// ---------- Conflits ----------

describe('Séances - conflits (409)', () => {
    test('même salle, même créneau → 409', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({ enseignant_id: ids.ens2, groupe_ids: [ids.g2] }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/salle/i);
        expect(await compter('seance')).toBe(1);
    });

    test('même enseignant, même créneau, salles différentes → 409', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({ salle_id: ids.salleB, groupe_ids: [ids.g2] }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/enseignant/i);
    });

    test('même groupe, même créneau → 409', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({ enseignant_id: ids.ens2, salle_id: ids.salleB }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/groupe/i);
    });

    test('groupe partagé entre deux séances (g1+g2 puis g2 seul) → 409', async () => {
        await creer(ids.s1, base({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g2] }));
        const res = await ajouter(ids.s1, base({
            enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2],
        }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/groupe/i);
    });

    test('chevauchement partiel (8h-10h puis 9h-11h), même salle → 409', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({
            creneau_id: ids.lun9, enseignant_id: ids.ens2, groupe_ids: [ids.g2],
        }));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/salle/i);
    });

    test('chevauchement partiel, même enseignant → 409', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({
            creneau_id: ids.lun9, salle_id: ids.salleB, groupe_ids: [ids.g2],
        }));
        expect(res.status).toBe(409);
    });

    test('chevauchement partiel, même groupe → 409', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({
            creneau_id: ids.lun9, enseignant_id: ids.ens2, salle_id: ids.salleB,
        }));
        expect(res.status).toBe(409);
    });

    test('créneaux qui se touchent (8h-10h puis 10h-12h), tout identique → 201', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({ creneau_id: ids.lun10 }));
        expect(res.status).toBe(201);
    });

    test('jours différents (lundi puis mardi), tout identique → 201', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({ creneau_id: ids.mar8 }));
        expect(res.status).toBe(201);
    });

    test('même créneau mais tout différent (salle, enseignant, groupe) → 201', async () => {
        await creer(ids.s1, base());
        const res = await ajouter(ids.s1, base({
            enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g2],
        }));
        expect(res.status).toBe(201);
    });

    describe('entre deux EDT différents', () => {
        test('même salle, même créneau, périodes qui se chevauchent → 409', async () => {
            await creer(ids.s1, base());
            const res = await ajouter(ids.f2s1, base({ enseignant_id: ids.ens2, groupe_ids: [ids.g3] }));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/salle/i);
        });

        test('même enseignant, même créneau, salles différentes → 409', async () => {
            await creer(ids.s1, base());
            const res = await ajouter(ids.f2s1, base({ salle_id: ids.salleB, groupe_ids: [ids.g3] }));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/enseignant/i);
        });

        test('semestres sans chevauchement (S1 puis S2), tout identique → 201', async () => {
            await creer(ids.s1, base());
            const res = await ajouter(ids.s2, base());
            expect(res.status).toBe(201);
        });

        test('parallèle autorisé : deux filières, ressources différentes → 201', async () => {
            await creer(ids.s1, base());
            const res = await ajouter(ids.f2s1, base({
                enseignant_id: ids.ens2, salle_id: ids.salleB, groupe_ids: [ids.g3],
            }));
            expect(res.status).toBe(201);
        });
    });

    describe('créneaux datés', () => {
        test('même date, même heure, même salle → 409', async () => {
            await creer(ids.s1, base({ creneau_id: ids.d1214 }));
            const res = await ajouter(ids.s1, base({
                creneau_id: ids.d1214, enseignant_id: ids.ens2, groupe_ids: [ids.g2],
            }));
            expect(res.status).toBe(409);
        });

        test('même date, heures qui se chevauchent (créneaux différents), même salle → 409', async () => {
            await creer(ids.s1, base({ creneau_id: ids.d1214 }));
            const res = await ajouter(ids.s1, base({
                creneau_id: ids.d1214b, enseignant_id: ids.ens2, groupe_ids: [ids.g2],
            }));
            expect(res.status).toBe(409);
        });

        test('dates différentes, même heure, tout identique → 201', async () => {
            await creer(ids.s1, base({ creneau_id: ids.d1207 }));
            const res = await ajouter(ids.s1, base({ creneau_id: ids.d1214 }));
            expect(res.status).toBe(201);
        });
    });

    describe('créneau daté contre créneau récurrent', () => {
        test('daté un lundi pendant la période du récurrent (lundi 8h) → 409', async () => {
            await creer(ids.s1, base()); // récurrent lundi 8h-10h, S1 (jusqu'au 20 décembre)
            const res = await ajouter(ids.edtB, base({
                creneau_id: ids.d1214, enseignant_id: ids.ens2, groupe_ids: [ids.g3],
            }));
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/salle/i);
        });

        test('daté un lundi APRÈS la fin de l’EDT du récurrent → 201', async () => {
            await creer(ids.s1, base()); // S1 se termine le 20 décembre
            const res = await ajouter(ids.edtB, base({
                creneau_id: ids.d1221, enseignant_id: ids.ens2, groupe_ids: [ids.g3],
            }));
            expect(res.status).toBe(201);
        });

        test('sens inverse : récurrent ajouté alors qu’un daté existe pendant sa période → 409', async () => {
            await creer(ids.edtB, base({
                creneau_id: ids.d1214, enseignant_id: ids.ens2, groupe_ids: [ids.g3],
            }));
            const res = await ajouter(ids.s1, base());
            expect(res.status).toBe(409);
        });

        test('sens inverse : le daté est après la fin de l’EDT du récurrent → 201', async () => {
            await creer(ids.edtB, base({
                creneau_id: ids.d1221, enseignant_id: ids.ens2, groupe_ids: [ids.g3],
            }));
            const res = await ajouter(ids.s1, base());
            expect(res.status).toBe(201);
        });

        test('daté un mardi, récurrent le lundi → 201 (jours différents)', async () => {
            // d1214 est un lundi ; on utilise le récurrent mardi
            await creer(ids.s1, base({ creneau_id: ids.mar8 }));
            const res = await ajouter(ids.edtB, base({
                creneau_id: ids.d1214, enseignant_id: ids.ens2, groupe_ids: [ids.g3],
            }));
            expect(res.status).toBe(201);
        });
    });
});

// ---------- Modification ----------

describe('Séances - modification', () => {
    test('modifier sans rien changer → 200 (une séance n’est pas en conflit avec elle-même)', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base());
        expect(res.status).toBe(200);
    });

    test('changer le créneau vers un créneau libre → 200 et enregistré', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base({ creneau_id: ids.mar8 }));
        expect(res.status).toBe(200);
        const row = await pool.query('SELECT creneau_id FROM seance WHERE id = $1', [s.id]);
        expect(row.rows[0].creneau_id).toBe(ids.mar8);
    });

    test('changer les groupes remplace les anciens', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base({ groupe_ids: [ids.g2] }));
        expect(res.status).toBe(200);
        const sg = await pool.query('SELECT groupe_id FROM seance_groupe WHERE seance_id = $1', [s.id]);
        expect(sg.rows).toEqual([{ groupe_id: ids.g2 }]);
    });

    test('changer enseignant, salle et module → 200 et enregistré', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base({
            enseignant_id: ids.ens2, salle_id: ids.salleB, module_id: ids.m2,
        }));
        expect(res.status).toBe(200);
        const row = (await pool.query('SELECT * FROM seance WHERE id = $1', [s.id])).rows[0];
        expect(row).toMatchObject({ enseignant_id: ids.ens2, salle_id: ids.salleB, module_id: ids.m2 });
    });

    test('déplacer vers un créneau déjà occupé (même salle) → 409 et rien ne change', async () => {
        await creer(ids.s1, base());
        const b = await creer(ids.s1, base({
            creneau_id: ids.mar8, enseignant_id: ids.ens2, groupe_ids: [ids.g2],
        }));
        const res = await modifier(ids.s1, b.id, base({
            creneau_id: ids.lun8, enseignant_id: ids.ens2, groupe_ids: [ids.g2],
        }));
        expect(res.status).toBe(409);
        const row = await pool.query('SELECT creneau_id FROM seance WHERE id = $1', [b.id]);
        expect(row.rows[0].creneau_id).toBe(ids.mar8);
    });

    test('les règles s’appliquent aussi en modification : salle en maintenance → 409', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base({ salle_id: ids.maintenance }));
        expect(res.status).toBe(409);
    });

    test('les règles s’appliquent aussi en modification : capacité insuffisante → 400', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s1, s.id, base({ groupe_ids: [ids.g1, ids.g2] }));
        expect(res.status).toBe(400);
    });

    test('séance inexistante → 404', async () => {
        const res = await modifier(ids.s1, 9999, base());
        expect(res.status).toBe(404);
    });

    test('séance qui appartient à un autre EDT → 400', async () => {
        const s = await creer(ids.s1, base());
        const res = await modifier(ids.s2, s.id, base());
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/EDT/);
    });

    test.each(['enseignant_id', 'module_id', 'salle_id', 'creneau_id', 'evenement_id', 'groupe_ids'])(
        'champ %s manquant → 400',
        async (champ) => {
            const s = await creer(ids.s1, base());
            const body = base();
            delete body[champ];
            const res = await modifier(ids.s1, s.id, body);
            expect(res.status).toBe(400);
        }
    );

    test('identifiant non numérique → 400', async () => {
        const res = await modifier(ids.s1, 'abc', base());
        expect(res.status).toBe(400);
    });
});

// ---------- Suppression ----------

describe('Séances - suppression', () => {
    test('supprimer → 200, la séance et ses groupes disparaissent', async () => {
        const s = await creer(ids.s1, base({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g2] }));
        const res = await supprimer(ids.s1, s.id);
        expect(res.status).toBe(200);
        expect(await compter('seance')).toBe(0);
        expect(await compter('seance_groupe')).toBe(0);
    });

    test('supprimer libère le créneau (on peut recréer la même séance)', async () => {
        const s = await creer(ids.s1, base());
        await supprimer(ids.s1, s.id);
        const res = await ajouter(ids.s1, base());
        expect(res.status).toBe(201);
    });

    test('séance inexistante → 404', async () => {
        const res = await supprimer(ids.s1, 9999);
        expect(res.status).toBe(404);
    });

    test('mauvais EDT dans l’URL → 404 et la séance reste', async () => {
        const s = await creer(ids.s1, base());
        const res = await supprimer(ids.s2, s.id);
        expect(res.status).toBe(404);
        expect(await compter('seance')).toBe(1);
    });

    test('identifiant non numérique → 400', async () => {
        const res = await supprimer(ids.s1, 'abc');
        expect(res.status).toBe(400);
    });
});

// ---------- Liste ----------

describe('Séances - liste', () => {
    test('EDT sans séance → tableau vide', async () => {
        const res = await lister(ids.s1);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('chaque séance contient module, enseignant, salle, horaires, événement et groupes', async () => {
        await creer(ids.s1, base({ salle_id: ids.amphi, groupe_ids: [ids.g1, ids.g2] }));
        const res = await lister(ids.s1);
        expect(res.body).toHaveLength(1);
        const s = res.body[0];
        expect(s).toMatchObject({
            nom_module: 'Algorithmique',
            enseignant_nom: 'Alami',
            nom_salle: 'Amphi A',
            jour: 'lundi',
            heure_debut: '08:00:00',
            heure_fin: '10:00:00',
            evenement: 'Cours',
        });
        expect([...s.groupes].sort()).toEqual(['G1', 'G2']);
        expect([...s.groupe_ids].sort()).toEqual([ids.g1, ids.g2].sort());
    });

    test('triées par jour de la semaine (lundi, mardi, jeudi), pas par ordre alphabétique', async () => {
        await creer(ids.s1, base({ creneau_id: ids.jeu8 }));
        await creer(ids.s1, base({ creneau_id: ids.lun8 }));
        await creer(ids.s1, base({ creneau_id: ids.mar8 }));
        const res = await lister(ids.s1);
        expect(res.body.map((s) => s.jour)).toEqual(['lundi', 'mardi', 'jeudi']);
    });

    test('triées par heure dans la même journée', async () => {
        await creer(ids.s1, base({ creneau_id: ids.lun10 }));
        await creer(ids.s1, base({ creneau_id: ids.lun8 }));
        const res = await lister(ids.s1);
        expect(res.body.map((s) => s.heure_debut)).toEqual(['08:00:00', '10:00:00']);
    });

    test('ne renvoie que les séances de l’EDT demandé', async () => {
        await creer(ids.s1, base());
        await creer(ids.s2, base());
        const res = await lister(ids.s1);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].edt_id).toBe(ids.s1);
    });

    test('identifiant d’EDT non numérique → 400', async () => {
        const res = await lister('abc');
        expect(res.status).toBe(400);
    });
});

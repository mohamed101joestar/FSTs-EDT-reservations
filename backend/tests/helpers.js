const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

const TABLES = [
    'niveau', 'filiere', 'groupe', 'module', 'utilisateur', 'notification', 'historique',
    'salle', 'equipement', 'evenement', 'creneau', 'edt', 'seance', 'seance_groupe',
    'reservation', 'demande_changement', 'conflit', 'conflit_reservation',
];

const resetDb = () => pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

const tokenFor = (user) =>
    jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

const insert = async (sql, params) => (await pool.query(`${sql} RETURNING id`, params)).rows[0].id;

/*
 * Données de test (dates vérifiées : 2026-09-07, 12-07, 12-14, 12-21 et 2027-03-01 sont des lundis)
 *
 * EDT s1   (filière f1) : 2026-09-01 → 2026-12-20      EDT s2    (filière f1) : 2027-01-05 → 2027-06-30
 * EDT f2s1 (filière f2) : 2026-09-01 → 2026-12-20      EDT edtB  (filière f2) : 2026-12-01 → 2027-01-31
 * Groupes : g1 (30) et g2 (30) en f1 ; g3 (25) en f2
 */
const seed = async () => {
    const ids = {};

    ids.niveau = await insert('INSERT INTO niveau (libelle, code_niveau) VALUES ($1, $2)', ['Licence', 'L3']);
    ids.f1 = await insert('INSERT INTO filiere (nom_filiere, code_filiere, niveau_id) VALUES ($1, $2, $3)', ['Génie Informatique', 'GI', ids.niveau]);
    ids.f2 = await insert('INSERT INTO filiere (nom_filiere, code_filiere, niveau_id) VALUES ($1, $2, $3)', ['Génie Civil', 'GC', ids.niveau]);

    const groupe = (nom, effectif, filiere) =>
        insert('INSERT INTO groupe (nom_groupe, effectif, filiere_id) VALUES ($1, $2, $3)', [nom, effectif, filiere]);
    ids.g1 = await groupe('G1', 30, ids.f1);
    ids.g2 = await groupe('G2', 30, ids.f1);
    ids.g3 = await groupe('G3', 25, ids.f2);

    ids.m1 = await insert('INSERT INTO module (nom_module, code_module) VALUES ($1, $2)', ['Algorithmique', 'ALGO']);
    ids.m2 = await insert('INSERT INTO module (nom_module, code_module) VALUES ($1, $2)', ['Bases de données', 'BDD']);
    ids.cours = await insert('INSERT INTO evenement (libelle) VALUES ($1)', ['Cours']);

    const salle = (nom, capacite, etat = 'disponible') =>
        insert('INSERT INTO salle (nom_salle, capacite, type_salle, etat) VALUES ($1, $2, $3, $4)', [nom, capacite, 'salle_td', etat]);
    ids.amphi = await salle('Amphi A', 100);
    ids.salleA = await salle('Salle A', 40);
    ids.salleB = await salle('Salle B', 40);
    ids.petite = await salle('Petite salle', 20);
    ids.pile = await salle('Salle 60', 60);
    ids.maintenance = await salle('Salle maintenance', 100, 'en_maintenance');
    ids.indispo = await salle('Salle indispo', 100, 'indisponible');

    const user = (nom, email, role) =>
        insert('INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role) VALUES ($1, $2, $3, $4, $5)', [nom, 'Test', email, 'hash', role]);
    ids.admin = await user('Admin', 'admin@test.ma', 'admin');
    ids.ens1 = await user('Alami', 'ens1@test.ma', 'enseignant');
    ids.ens2 = await user('Bennani', 'ens2@test.ma', 'enseignant');

    const creneau = (date, jour, debut, fin) =>
        insert('INSERT INTO creneau (date_creneau, jour, heure_debut, heure_fin) VALUES ($1, $2, $3, $4)', [date, jour, debut, fin]);
    // récurrents
    ids.lun8 = await creneau(null, 'lundi', '08:00', '10:00');
    ids.lun9 = await creneau(null, 'lundi', '09:00', '11:00');
    ids.lun10 = await creneau(null, 'lundi', '10:00', '12:00');
    ids.mar8 = await creneau(null, 'mardi', '08:00', '10:00');
    ids.jeu8 = await creneau(null, 'jeudi', '08:00', '10:00');
    // datés
    ids.d1207 = await creneau('2026-12-07', 'lundi', '08:00', '10:00');
    ids.d1214 = await creneau('2026-12-14', 'lundi', '08:00', '10:00');
    ids.d1214b = await creneau('2026-12-14', 'lundi', '09:00', '11:00');
    ids.d1221 = await creneau('2026-12-21', 'lundi', '08:00', '10:00');
    ids.dHors = await creneau('2027-03-01', 'lundi', '08:00', '10:00');
    ids.d1215 = await creneau('2026-12-15', 'mardi', '08:00', '10:00');
    ids.d1216 = await creneau('2026-12-16', 'mercredi', '08:00', '10:00');
    ids.dPasse = await creneau('2026-10-05', 'lundi', '08:00', '10:00'); // avant le "jour J" figé (21/11/2026)

    const edt = (titre, semestre, debut, fin, filiere) =>
        insert('INSERT INTO edt (titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [titre, '2026-2027', semestre, debut, fin, filiere]);
    ids.s1 = await edt('S1 GI', 'S1', '2026-09-01', '2026-12-20', ids.f1);
    ids.s2 = await edt('S2 GI', 'S2', '2027-01-05', '2027-06-30', ids.f1);
    ids.f2s1 = await edt('S1 GC', 'S1', '2026-09-01', '2026-12-20', ids.f2);
    ids.edtB = await edt('Rattrapage GC', 'S1', '2026-12-01', '2027-01-31', ids.f2);

    return ids;
};

// Date du jour figée pour les tests qui dépendent de "aujourd'hui" (réservations, demandes de changement).
// Seul Date est simulé : les créneaux du seed (décembre 2026) restent dans le futur quelle que soit
// la date réelle d'exécution. Utilisation : beforeAll(() => jest.useFakeTimers(FAKE_TIMERS)).
const NOW = new Date('2026-11-21T10:00:00');
const FAKE_TIMERS = {
    now: NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
        'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
        'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
};

module.exports = { pool, resetDb, seed, tokenFor, FAKE_TIMERS, NOW };
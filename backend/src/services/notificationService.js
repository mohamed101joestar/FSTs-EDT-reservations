const pool = require('../config/db');

const LONGUEUR_MAX = 255; // taille de la colonne notification.message

const tronquer = (message) => {
    const m = String(message);
    return m.length > LONGUEUR_MAX ? `${m.slice(0, LONGUEUR_MAX - 1)}…` : m;
};

// Envoie le même message à une ou plusieurs personnes (sans doublon)
const notifier = async (utilisateurIds, message, executor = pool) => {
    const ids = [...new Set((Array.isArray(utilisateurIds) ? utilisateurIds : [utilisateurIds]).filter(Boolean).map(Number))];
    if (ids.length === 0) return;
    await executor.query(
        'INSERT INTO notification (message, utilisateur_id) SELECT $1, UNNEST($2::int[])',
        [tronquer(message), ids]);
};

// Envoie un message à tous les administrateurs (sauf, éventuellement, celui qui agit)
const notifierAdmins = async (message, executor = pool, exclureId = null) => {
    await executor.query(`
        INSERT INTO notification (message, utilisateur_id)
        SELECT $1, id FROM utilisateur WHERE role = 'admin' AND ($2::int IS NULL OR id <> $2)
    `, [tronquer(message), exclureId]);
};

module.exports = { notifier, notifierAdmins, tronquer, LONGUEUR_MAX };
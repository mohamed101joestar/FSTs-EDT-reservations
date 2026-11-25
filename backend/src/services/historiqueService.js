const pool = require('../config/db');

// Valeur stockée en texte : les objets sont convertis en JSON, null/undefined restent NULL.
const texte = (v) => {
    if (v === undefined || v === null) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
};

/**
 * Écrit une ligne dans l'historique.
 *   action      : ex. 'reservation.confirmee' (50 caractères max)
 *   entite      : ex. 'reservation'            (50 caractères max)
 *   id_entite   : identifiant de l'élément concerné (référence logique, sans clé étrangère)
 *   ancienne / nouvelle : valeurs avant / après (objet ou texte)
 *   utilisateur_id : la personne qui agit
 * executor : pool (par défaut) ou un client de transaction.
 */
const journaliser = async ({ action, entite, id_entite, ancienne = null, nouvelle = null, utilisateur_id }, executor = pool) => {
    await executor.query(`
        INSERT INTO historique (action, entite_concernee, id_entite, ancienne_valeur, nouvelle_valeur, utilisateur_id)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [String(action).slice(0, 50), String(entite).slice(0, 50), id_entite, texte(ancienne), texte(nouvelle), utilisateur_id]);
};

module.exports = { journaliser, texte };
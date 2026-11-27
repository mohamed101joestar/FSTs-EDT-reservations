const pool = require('../config/db');

// Erreur "métier" levée à l'intérieur d'une transaction : annule tout et devient une réponse HTTP claire.
class ErreurMetier extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Exécute `travail(client)` dans une transaction : tout réussit, ou rien n'est enregistré.
const enTransaction = async (travail) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultat = await travail(client);
        await client.query('COMMIT');
        return resultat;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { enTransaction, ErreurMetier };
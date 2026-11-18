const pool = require('../config/db');

const createUser = async (nom, prenom, email, motDePasseHash, role) => {
    const query = `
    INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, nom, prenom, email, role
  `;

    const values = [nom, prenom, email, motDePasseHash, role];
    const result = await pool.query(query, values);
    return result.rows[0];

};

const getUserByEmail = async (email) => {
    const query = `SELECT * FROM utilisateur WHERE email =$1`;
    const result = await pool.query(query, [email]);
    return result.rows[0];
};

module.exports = {
    createUser,
    getUserByEmail,
};



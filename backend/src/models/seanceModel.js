const pool = require('../config/db');

const createSeance = async (edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const querySeance = `
            INSERT INTO seance (edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        `;
        const valuesSeance = [edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id];
        const resSeance = await client.query(querySeance, valuesSeance);
        const nouvelleSeance = resSeance.rows[0];

        if (groupe_ids && groupe_ids.length > 0) {
            for (const groupe_id of groupe_ids) {
                await client.query('INSERT INTO seance_groupe (seance_id, groupe_id) VALUES ($1, $2)', [nouvelleSeance.id, groupe_id]);
            }
        }
        await client.query('COMMIT');
        return { ...nouvelleSeance, groupe_ids };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const updateSeance = async (id, edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const query = `
            UPDATE seance 
            SET edt_id = $1, enseignant_id = $2, module_id = $3, salle_id = $4, creneau_id = $5, evenement_id = $6
            WHERE id = $7 RETURNING *
        `;
        const values = [edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, id];
        const res = await client.query(query, values);
        
        // On met à jour les groupes (suppression des anciens, insertion des nouveaux)
        await client.query('DELETE FROM seance_groupe WHERE seance_id = $1', [id]);
        if (groupe_ids && groupe_ids.length > 0) {
            for (const groupe_id of groupe_ids) {
                await client.query('INSERT INTO seance_groupe (seance_id, groupe_id) VALUES ($1, $2)', [id, groupe_id]);
            }
        }
        await client.query('COMMIT');
        return { ...res.rows[0], groupe_ids };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const getSeancesByEdt = async (edt_id) => {
    const query = `
        SELECT s.id, s.edt_id, s.enseignant_id, s.module_id, s.salle_id, s.creneau_id, s.evenement_id,
               m.nom_module, u.nom as enseignant_nom, u.prenom as enseignant_prenom,
               sa.nom_salle, c.jour, c.heure_debut, c.heure_fin, ev.libelle as evenement,
               COALESCE(json_agg(g.id) FILTER (WHERE g.id IS NOT NULL), '[]') as groupe_ids,
               COALESCE(json_agg(g.nom_groupe) FILTER (WHERE g.id IS NOT NULL), '[]') as groupes
        FROM seance s
        JOIN module m ON s.module_id = m.id
        JOIN utilisateur u ON s.enseignant_id = u.id
        JOIN salle sa ON s.salle_id = sa.id
        JOIN creneau c ON s.creneau_id = c.id
        JOIN evenement ev ON s.evenement_id = ev.id
        LEFT JOIN seance_groupe sg ON s.id = sg.seance_id
        LEFT JOIN groupe g ON sg.groupe_id = g.id
        WHERE s.edt_id = $1
        GROUP BY s.id, m.nom_module, u.nom, u.prenom, sa.nom_salle, c.jour, c.heure_debut, c.heure_fin, ev.libelle
        ORDER BY c.jour, c.heure_debut ASC
    `;
    const result = await pool.query(query, [edt_id]);
    return result.rows;
};

const deleteSeance = async (id) => {
    const result = await pool.query('DELETE FROM seance WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = { createSeance, updateSeance, getSeancesByEdt, deleteSeance };
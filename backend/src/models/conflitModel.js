const pool = require('../config/db');

// Conflits avec leurs demandes (état ACTUEL de chaque demande). statut = 'ouvert' | 'resolu' | null (tous)
const getConflits = async (statut = null) => {
    const res = await pool.query(`
        SELECT c.id, c.type_conflit, c.statut, c.date_detection, c.description,
               COALESCE((
                   SELECT json_agg(json_build_object(
                       'id', r.id, 'statut', r.statut,
                       'enseignant_id', r.enseignant_id, 'enseignant_nom', u.nom, 'enseignant_prenom', u.prenom,
                       'nom_salle', s.nom_salle, 'nom_groupe', g.nom_groupe,
                       'date_creneau', cr.date_creneau, 'heure_debut', cr.heure_debut, 'heure_fin', cr.heure_fin
                   ) ORDER BY r.id)
                   FROM conflit_reservation x
                   JOIN reservation r ON r.id = x.reservation_id
                   JOIN utilisateur u ON u.id = r.enseignant_id
                   JOIN salle s ON s.id = r.salle_id
                   JOIN creneau cr ON cr.id = r.creneau_id
                   LEFT JOIN groupe g ON g.id = r.groupe_id
                   WHERE x.conflit_id = c.id
               ), '[]'::json) AS reservations,
               COALESCE((
                   SELECT json_agg(json_build_object(
                       'id', d.id, 'type_demande', d.type_demande, 'statut', d.statut,
                       'date_occurrence', d.date_occurrence,
                       'enseignant_id', d.enseignant_id, 'enseignant_nom', u.nom, 'enseignant_prenom', u.prenom,
                       'nom_module', m.nom_module, 'salle_actuelle', sa.nom_salle, 'nouvelle_salle', ns.nom_salle,
                       'nouveau_creneau_id', d.nouveau_creneau_id
                   ) ORDER BY d.id)
                   FROM conflit_demande x
                   JOIN demande_changement d ON d.id = x.demande_changement_id
                   JOIN utilisateur u ON u.id = d.enseignant_id
                   JOIN seance se ON se.id = d.seance_id
                   JOIN module m ON m.id = se.module_id
                   JOIN salle sa ON sa.id = se.salle_id
                   LEFT JOIN salle ns ON ns.id = d.nouvelle_salle_id
                   WHERE x.conflit_id = c.id
               ), '[]'::json) AS demandes
        FROM conflit c
        WHERE ($1::text IS NULL OR c.statut = $1)
        ORDER BY (c.statut = 'ouvert') DESC, c.date_detection DESC, c.id DESC
    `, [statut]);
    return res.rows;
};

module.exports = { getConflits };
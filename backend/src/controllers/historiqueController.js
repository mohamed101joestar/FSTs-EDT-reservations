const historiqueModel = require('../models/historiqueModel');
const { estDateValide } = require('../utils/timeUtils');

const entierPositif = (v) => /^\d+$/.test(String(v));

const listerHistorique = async (req, res) => {
    try {
        const { entite, id_entite, utilisateur_id, action, depuis, jusqua } = req.query;
        let { limit = '50', offset = '0' } = req.query;

        if (!entierPositif(limit) || Number(limit) < 1 || Number(limit) > 200) {
            return res.status(400).json({ message: "limit doit être un entier entre 1 et 200." });
        }
        if (!entierPositif(offset)) return res.status(400).json({ message: "offset doit être un entier positif ou nul." });
        if (id_entite !== undefined && !entierPositif(id_entite)) return res.status(400).json({ message: "id_entite invalide." });
        if (utilisateur_id !== undefined && !entierPositif(utilisateur_id)) return res.status(400).json({ message: "utilisateur_id invalide." });
        if (depuis !== undefined && !estDateValide(depuis)) return res.status(400).json({ message: "depuis doit être une date AAAA-MM-JJ." });
        if (jusqua !== undefined && !estDateValide(jusqua)) return res.status(400).json({ message: "jusqua doit être une date AAAA-MM-JJ." });
        for (const [nom, v] of [['entite', entite], ['action', action]]) {
            if (v !== undefined && (typeof v !== 'string' || v.length > 50)) {
                return res.status(400).json({ message: `${nom} invalide.` });
            }
        }

        const donnees = await historiqueModel.getHistorique({
            entite: entite || null,
            id_entite: id_entite === undefined ? null : Number(id_entite),
            utilisateur_id: utilisateur_id === undefined ? null : Number(utilisateur_id),
            action: action || null,
            depuis: depuis || null,
            jusqua: jusqua || null,
            limit: Number(limit),
            offset: Number(offset),
        });
        res.status(200).json({ total: donnees.total, limit: Number(limit), offset: Number(offset), resultats: donnees.resultats });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

module.exports = { listerHistorique };
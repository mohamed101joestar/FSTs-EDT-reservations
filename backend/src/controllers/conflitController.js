const conflitModel = require('../models/conflitModel');
const conflitService = require('../services/conflitService');

const listerConflits = async (req, res) => {
    try {
        const { statut } = req.query;
        if (statut !== undefined && !['ouvert', 'resolu'].includes(statut)) {
            return res.status(400).json({ message: "Statut invalide (ouvert ou resolu)." });
        }
        // Filet de sécurité : on resynchronise avant de lire, pour ne jamais montrer un état périmé
        await conflitService.recalculerConflitsSansErreur();
        const conflits = await conflitModel.getConflits(statut || null);
        res.status(200).json(conflits);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

module.exports = { listerConflits };
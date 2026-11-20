const seanceModel = require('../models/seanceModel');
const seanceService = require('../services/seanceService');

const ajouterSeance = async (req, res) => {
    try {
        const { edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids } = req.body;
        if (!edt_id || !enseignant_id || !module_id || !salle_id || !creneau_id || !evenement_id) {
            return res.status(400).json({ message: "Tous les champs sont obligatoires." });
        }

        const verification = await seanceService.validerToutesLesRegles(req.body);
        if (!verification.valide) {
            return res.status(verification.status).json({ message: verification.message });
        }

        const nouvelleSeance = await seanceModel.createSeance(edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids);
        res.status(201).json({ message: "Séance ajoutée", seance: nouvelleSeance });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Un des IDs fournis n'existe pas." });
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

const modifierSeance = async (req, res) => {
    try {
        const { id } = req.params;
        const { edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids } = req.body;

        const verification = await seanceService.validerToutesLesRegles(req.body, id);
        if (!verification.valide) {
            return res.status(verification.status).json({ message: verification.message });
        }

        const seanceMiseAJour = await seanceModel.updateSeance(id, edt_id, enseignant_id, module_id, salle_id, creneau_id, evenement_id, groupe_ids);
        res.status(200).json({ message: "Séance mise à jour", seance: seanceMiseAJour });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la modification." });
    }
};

const listerSeancesParEdt = async (req, res) => {
    try {
        const { edtId } = req.params;
        const seances = await seanceModel.getSeancesByEdt(edtId);
        res.status(200).json(seances);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerSeance = async (req, res) => {
    try {
        const { id } = req.params;
        const seanceSupprimee = await seanceModel.deleteSeance(id);
        if (!seanceSupprimee) return res.status(404).json({ message: "Séance non trouvée." });
        res.status(200).json({ message: "Séance supprimée." });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterSeance, modifierSeance, listerSeancesParEdt, supprimerSeance };
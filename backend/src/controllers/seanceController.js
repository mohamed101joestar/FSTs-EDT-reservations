const seanceModel = require('../models/seanceModel');
const seanceService = require('../services/seanceService');
const edtModel = require('../models/edtModel');
const conflitService = require('../services/conflitService');

const MSG_CHAMPS = "Tous les champs sont obligatoires (enseignant_id, module_id, salle_id, creneau_id, evenement_id) et groupe_ids doit être un tableau non vide d'identifiants.";

const reponseErreurSql = (error, res) => {
    if (error.code === '23503') return res.status(400).json({ message: "Un des IDs fournis n'existe pas." });
    console.error(error);
    return res.status(500).json({ message: "Erreur interne." });
};

const ajouterSeance = async (req, res) => {
    try {
        const edtId = Number(req.params.edtId);
        if (!Number.isInteger(edtId)) return res.status(400).json({ message: "Identifiant d'EDT invalide." });

        const d = seanceService.normaliserSeance(req.body);
        if (!d) return res.status(400).json({ message: MSG_CHAMPS });

        const edt = await edtModel.getEdtById(edtId);
        if (!edt) return res.status(404).json({ message: "EDT introuvable." });

        const erreur = await seanceService.validerToutesLesRegles({ edt_id: edtId, ...d });
        if (erreur) return res.status(erreur.status).json({ message: erreur.message });

        const nouvelleSeance = await seanceModel.createSeance(
            edtId, d.enseignant_id, d.module_id, d.salle_id, d.creneau_id, d.evenement_id, d.groupe_ids
        );
        // Les demandes en attente qui visaient cette place sont désormais bloquées : on les signale à l'admin
        const demandes_en_conflit = await conflitService.impactDeSeance(nouvelleSeance.id);
        await conflitService.recalculerConflitsSansErreur();
        res.status(201).json({ message: "Séance ajoutée", seance: nouvelleSeance, demandes_en_conflit });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

const modifierSeance = async (req, res) => {
    try {
        const edtId = Number(req.params.edtId);
        const id = Number(req.params.id);
        if (!Number.isInteger(edtId) || !Number.isInteger(id)) {
            return res.status(400).json({ message: "Identifiant invalide." });
        }

        const d = seanceService.normaliserSeance(req.body);
        if (!d) return res.status(400).json({ message: MSG_CHAMPS });

        const seanceExistante = await seanceModel.getSeanceById(id);
        if (!seanceExistante) return res.status(404).json({ message: "Séance introuvable." });
        if (seanceExistante.edt_id !== edtId) {
            return res.status(400).json({ message: "Cette séance n'appartient pas à cet EDT." });
        }

        const erreur = await seanceService.validerToutesLesRegles({ edt_id: edtId, ...d }, id);
        if (erreur) return res.status(erreur.status).json({ message: erreur.message });

        const seanceMiseAJour = await seanceModel.updateSeance(
            id, edtId, d.enseignant_id, d.module_id, d.salle_id, d.creneau_id, d.evenement_id, d.groupe_ids
        );
        const demandes_en_conflit = await conflitService.impactDeSeance(id);
        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: "Séance mise à jour", seance: seanceMiseAJour, demandes_en_conflit });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

const listerSeancesParEdt = async (req, res) => {
    try {
        const edtId = Number(req.params.edtId);
        if (!Number.isInteger(edtId)) return res.status(400).json({ message: "Identifiant d'EDT invalide." });

        const seances = await seanceModel.getSeancesByEdt(edtId);
        res.status(200).json(seances);
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

const supprimerSeance = async (req, res) => {
    try {
        const edtId = Number(req.params.edtId);
        const id = Number(req.params.id);
        if (!Number.isInteger(edtId) || !Number.isInteger(id)) {
            return res.status(400).json({ message: "Identifiant invalide." });
        }

        const seance = await seanceModel.getSeanceById(id);
        if (!seance || seance.edt_id !== edtId) return res.status(404).json({ message: "Séance non trouvée dans cet EDT." });

        await seanceModel.deleteSeance(id);
        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: "Séance supprimée." });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

module.exports = { ajouterSeance, modifierSeance, listerSeancesParEdt, supprimerSeance };
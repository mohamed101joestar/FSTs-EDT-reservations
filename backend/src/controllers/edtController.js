const edtModel = require('../models/edtModel');
const conflitService = require('../services/conflitService');
const activite = require('../services/activiteService');

// Traduit les erreurs PostgreSQL courantes en réponses claires
const reponseErreur = (error, res, messageParDefaut) => {
    if (error.code === '23503') return res.status(400).json({ message: "La filière spécifiée n'existe pas." });
    if (error.code === '23514') {
        return res.status(400).json({
            message: "Données invalides : date_fin doit être ≥ date_debut et l'année universitaire au format 2026-2027."
        });
    }
    // 22007 / 22008 : date illisible ; 22P02 : mauvais type (ex. texte à la place d'un nombre)
    if (['22007', '22008', '22P02'].includes(error.code)) {
        return res.status(400).json({ message: "Un des champs a un format invalide (dates : AAAA-MM-JJ)." });
    }
    console.error(error);
    return res.status(500).json({ message: messageParDefaut });
};

const ajouterEdt = async (req, res) => {
    try {
        const { titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id } = req.body;
        if (!titre || !annee_universitaire || !semestre || !date_debut || !date_fin || !filiere_id) {
            return res.status(400).json({ message: "Tous les champs sont obligatoires." });
        }
        const nouvelEdt = await edtModel.createEdt(titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id);
        await activite.creation('edt', nouvelEdt, req.user.id);
        res.status(201).json({ message: "EDT créé", edt: nouvelEdt });
    } catch (error) {
        reponseErreur(error, res, "Erreur lors de la création de l'EDT.");
    }
};

const listerEdts = async (req, res) => {
    try {
        const edts = await edtModel.getAllEdts();
        res.status(200).json(edts);
    } catch (error) {
        reponseErreur(error, res, "Erreur lors de la récupération.");
    }
};

const supprimerEdt = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant d'EDT invalide." });

        const resume = await edtModel.getResumeEdt(id); // ce que la suppression va emporter (séances, enseignants)
        const edtSupprime = await edtModel.deleteEdt(id);
        if (!edtSupprime) return res.status(404).json({ message: "EDT non trouvé." });
        await activite.edtSupprime(edtSupprime, resume, req.user.id);
        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: "EDT supprimé." });
    } catch (error) {
        reponseErreur(error, res, "Erreur lors de la suppression.");
    }
};

module.exports = { ajouterEdt, listerEdts, supprimerEdt };
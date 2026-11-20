const edtModel = require('../models/edtModel');

const ajouterEdt = async (req, res) => {
    try {
        const { titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id } = req.body;
        if (!titre || !annee_universitaire || !semestre || !date_debut || !date_fin || !filiere_id) {
            return res.status(400).json({ message: "Tous les champs sont obligatoires." });
        }
        const nouvelEdt = await edtModel.createEdt(titre, annee_universitaire, semestre, date_debut, date_fin, filiere_id);
        res.status(201).json({ message: "EDT créé", edt: nouvelEdt });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "La filière spécifiée n'existe pas." });
        res.status(500).json({ message: "Erreur lors de la création de l'EDT." });
    }
};

const listerEdts = async (req, res) => {
    try {
        const edts = await edtModel.getAllEdts();
        res.status(200).json(edts);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerEdt = async (req, res) => {
    try {
        const { id } = req.params;
        const edtSupprime = await edtModel.deleteEdt(id);
        if (!edtSupprime) return res.status(404).json({ message: "EDT non trouvé." });
        res.status(200).json({ message: "EDT supprimé." });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterEdt, listerEdts, supprimerEdt };
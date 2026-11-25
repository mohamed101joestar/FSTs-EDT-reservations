const activite = require('../services/activiteService');
const groupeModel = require('../models/groupeModel');

const ajouterGroupe = async (req, res) => {
    try {
        const { nom_groupe, effectif, filiere_id } = req.body;
        if (!nom_groupe || !effectif || !filiere_id) {
            return res.status(400).json({ message: "nom_groupe, effectif et filiere_id sont obligatoires." });
        }

        const nouveauGroupe = await groupeModel.createGroupe(nom_groupe, effectif, filiere_id);
        await activite.creation('groupe', nouveauGroupe, req.user.id);
        res.status(201).json({ message: "Groupe créé", groupe: nouveauGroupe });
    } catch (error) {
        // 23505 = Doublon (ex: deux groupes "G1" dans la même filière)
        if (error.code === '23505') return res.status(400).json({ message: "Ce nom de groupe existe déjà pour cette filière." });
        // 23503 = La filière n'existe pas
        if (error.code === '23503') return res.status(400).json({ message: "La filière spécifiée n'existe pas." });
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

const listerGroupes = async (req, res) => {
    try {
        const groupes = await groupeModel.getAllGroupes();
        res.status(200).json(groupes);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerGroupe = async (req, res) => {
    try {
        const { id } = req.params;
        const groupeSupprime = await groupeModel.deleteGroupe(id);
        if (!groupeSupprime) return res.status(404).json({ message: "Groupe non trouvé." });
        await activite.suppression('groupe', groupeSupprime, req.user.id);
        res.status(200).json({ message: "Groupe supprimé." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : ce groupe est lié à une séance." });
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterGroupe, listerGroupes, supprimerGroupe };
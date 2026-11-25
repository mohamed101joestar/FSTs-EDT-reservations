const salleModel = require('../models/salleModel');
const activite = require('../services/activiteService');

const ajouterSalle = async (req, res) => {
    try {
        const { nom_salle, capacite, type_salle, etat } = req.body;
        
        if (!nom_salle || !capacite || !type_salle) {
            return res.status(400).json({ message: "nom_salle, capacite et type_salle sont obligatoires." });
        }

        const nouvelleSalle = await salleModel.createSalle(nom_salle, capacite, type_salle, etat);
        await activite.creation('salle', nouvelleSalle, req.user.id);
        res.status(201).json({ message: "Salle créée avec succès", salle: nouvelleSalle });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: "Une salle avec ce nom existe déjà." });
        console.error(error);
        res.status(500).json({ message: "Erreur lors de la création de la salle." });
    }
};

const listerSalles = async (req, res) => {
    try {
        const salles = await salleModel.getAllSalles();
        res.status(200).json(salles);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur lors de la récupération des salles." });
    }
};

const modifierSalle = async (req, res) => {
    try {
        const { id } = req.params;
        const { nom_salle, capacite, type_salle, etat } = req.body;

        const salleExistante = await salleModel.getSalleById(id);
        if (!salleExistante) return res.status(404).json({ message: "Salle non trouvée." });

        const salleMiseAJour = await salleModel.updateSalle(id, nom_salle, capacite, type_salle, etat);
        await activite.salleModifiee(salleExistante, salleMiseAJour, req.user.id);
        res.status(200).json({ message: "Salle mise à jour", salle: salleMiseAJour });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: "Une autre salle porte déjà ce nom." });
        console.error(error);
        res.status(500).json({ message: "Erreur lors de la modification." });
    }
};

const supprimerSalle = async (req, res) => {
    try {
        const { id } = req.params;
        const salleSupprimee = await salleModel.deleteSalle(id);

        if (!salleSupprimee) return res.status(404).json({ message: "Salle non trouvée." });
        await activite.suppression('salle', salleSupprimee, req.user.id);
        res.status(200).json({ message: "Salle supprimée avec succès." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : cette salle est utilisée dans une réservation." });
        console.error(error);
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = {
    ajouterSalle,
    listerSalles,
    modifierSalle,
    supprimerSalle
};
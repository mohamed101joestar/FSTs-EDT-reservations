const notificationModel = require('../models/notificationModel');

const entierPositif = (v) => /^\d+$/.test(String(v));

const listerNotifications = async (req, res) => {
    try {
        const { non_lues, limit = '50', offset = '0' } = req.query;
        if (non_lues !== undefined && !['true', 'false'].includes(non_lues)) {
            return res.status(400).json({ message: "non_lues doit valoir true ou false." });
        }
        if (!entierPositif(limit) || Number(limit) < 1 || Number(limit) > 200) {
            return res.status(400).json({ message: "limit doit être un entier entre 1 et 200." });
        }
        if (!entierPositif(offset)) return res.status(400).json({ message: "offset doit être un entier positif ou nul." });

        const notifications = await notificationModel.getNotifications(req.user.id, {
            nonLuesSeulement: non_lues === 'true', limit: Number(limit), offset: Number(offset),
        });
        res.status(200).json(notifications);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

const compterNonLues = async (req, res) => {
    try {
        res.status(200).json({ non_lues: await notificationModel.compterNonLues(req.user.id) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

const marquerLue = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de notification invalide." });
        const notification = await notificationModel.marquerLue(id, req.user.id);
        // 404 aussi pour la notification d'une autre personne : on ne révèle pas son existence
        if (!notification) return res.status(404).json({ message: "Notification introuvable." });
        res.status(200).json(notification);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

const marquerToutesLues = async (req, res) => {
    try {
        const modifiees = await notificationModel.marquerToutesLues(req.user.id);
        res.status(200).json({ message: "Notifications marquées comme lues.", modifiees });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

module.exports = { listerNotifications, compterNonLues, marquerLue, marquerToutesLues };
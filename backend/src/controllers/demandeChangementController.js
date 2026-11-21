const demandeModel = require('../models/demandeChangementModel');
const demandeService = require('../services/demandeChangementService');

const STATUTS = ['en_attente', 'acceptee', 'refusee'];

const reponseErreurSql = (error, res) => {
    if (error.code === '23503') return res.status(400).json({ message: "Un des IDs fournis n'existe pas." });
    if (error.code === '23514') return res.status(400).json({ message: "Données incohérentes pour ce type de demande." });
    if (error.code === '22001') return res.status(400).json({ message: "Un des textes est trop long (255 caractères maximum)." });
    console.error(error);
    return res.status(500).json({ message: "Erreur interne." });
};

const demanderChangement = async (req, res) => {
    try {
        const prep = await demandeService.preparerDemande(req.body || {}, req.user.id);
        if (prep.erreur) return res.status(prep.erreur.status).json({ message: prep.erreur.message });

        const erreur = await demandeService.verifierFaisabilite(prep.demande, prep.seance);
        if (erreur) return res.status(erreur.status).json({ message: erreur.message });

        const demande = await demandeModel.createDemande(prep.demande);
        res.status(201).json({ message: "Demande de changement envoyée.", demande });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

const listerDemandes = async (req, res) => {
    try {
        const { statut } = req.query;
        if (statut !== undefined && !STATUTS.includes(statut)) {
            return res.status(400).json({ message: "Statut invalide (en_attente, acceptee ou refusee)." });
        }
        const enseignant_id = req.user.role === 'enseignant' ? req.user.id : null;
        const demandes = await demandeModel.getAllDemandes({ enseignant_id, statut: statut || null });
        res.status(200).json(demandes);
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

const traiterDemande = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de demande invalide." });

        const { statut, motif_refus } = req.body || {};
        if (!['acceptee', 'refusee'].includes(statut)) {
            return res.status(400).json({ message: "Statut invalide (acceptee ou refusee)." });
        }
        if (statut === 'refusee') {
            if (typeof motif_refus !== 'string' || !motif_refus.trim()) {
                return res.status(400).json({ message: "Un motif de refus est obligatoire." });
            }
            if (motif_refus.trim().length > 255) {
                return res.status(400).json({ message: "Le motif est trop long (255 caractères maximum)." });
            }
        }

        const demande = await demandeModel.getDemandeById(id);
        if (!demande) return res.status(404).json({ message: "Demande introuvable." });
        if (demande.statut !== 'en_attente') {
            return res.status(400).json({ message: "Cette demande a déjà été traitée." });
        }

        let resultat;
        if (statut === 'refusee') {
            resultat = await demandeModel.refuserDemande(id, motif_refus.trim(), req.user.id);
        } else {
            // Le planning a pu changer depuis la demande : on revérifie tout avant d'accepter.
            const seance = await demandeModel.getSeanceDetails(demande.seance_id);
            const erreur = await demandeService.verifierFaisabilite(demande, seance);
            if (erreur) return res.status(409).json({ message: `Impossible d'accepter : ${erreur.message}` });

            resultat = demande.type_demande === 'deplacement_definitif'
                ? await demandeModel.accepterDemandeDefinitive(
                    id, req.user.id, demande.seance_id,
                    demande.nouveau_creneau_id || seance.creneau_id,
                    demande.nouvelle_salle_id || seance.salle_id)
                : await demandeModel.accepterDemandePonctuelle(id, req.user.id);
        }

        if (!resultat) return res.status(409).json({ message: "Cette demande vient d'être traitée par un autre administrateur." });
        res.status(200).json({ message: `Demande ${statut}.`, demande: resultat });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

module.exports = { demanderChangement, listerDemandes, traiterDemande };
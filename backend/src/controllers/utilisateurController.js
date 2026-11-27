const bcrypt = require('bcrypt');
const userModel = require('../models/usermodel');
const activite = require('../services/activiteService');
const { enTransaction, ErreurMetier } = require('../utils/transaction');
const { aujourdHui } = require('../utils/timeUtils');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'enseignant'];
const entierPositif = (v) => /^\d+$/.test(String(v));
const texte = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const motDePasseValide = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 72; // bcrypt ignore au-delà de 72 octets

// Valide les champs d'un compte. complet = création (tout est obligatoire sauf le rôle) ; sinon modification partielle.
const validerChamps = (body, { complet }) => {
    const valeurs = {};
    const verifs = [
        ['nom', (v) => texte(v, 50), 'nom (1 à 50 caractères)'],
        ['prenom', (v) => texte(v, 50), 'prénom (1 à 50 caractères)'],
        ['email', (v) => texte(v, 100) && EMAIL.test(v.trim()), 'email valide (100 caractères maximum)'],
    ];
    for (const [champ, valide, libelle] of verifs) {
        if (body[champ] === undefined) {
            if (complet) return { erreur: `Le champ ${champ} est obligatoire : ${libelle}.` };
            continue;
        }
        if (!valide(body[champ])) return { erreur: `Champ invalide : ${libelle}.` };
        valeurs[champ] = body[champ].trim();
    }
    if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) return { erreur: "Rôle invalide (admin ou enseignant)." };
        valeurs.role = body.role;
    } else if (complet) {
        valeurs.role = 'enseignant';
    }
    if (complet) {
        if (!motDePasseValide(body.mot_de_passe)) return { erreur: "Le mot de passe doit contenir entre 8 et 72 caractères." };
        valeurs.mot_de_passe = body.mot_de_passe;
    }
    return { valeurs };
};

const reponseErreur = (error, res) => {
    if (error instanceof ErreurMetier) return res.status(error.status).json({ message: error.message });
    if (error.code === '23505') return res.status(409).json({ message: "Cette adresse email est déjà utilisée." });
    console.error(error);
    return res.status(500).json({ message: "Erreur interne." });
};

const idValide = (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ message: "Identifiant d'utilisateur invalide." });
        return null;
    }
    return id;
};

// ---------------------------------------------------------------- Consultation

const listerUtilisateurs = async (req, res) => {
    try {
        const { role, actif, recherche } = req.query;
        const { limit = '50', offset = '0' } = req.query;
        if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ message: "role doit valoir admin ou enseignant." });
        if (actif !== undefined && !['true', 'false'].includes(actif)) return res.status(400).json({ message: "actif doit valoir true ou false." });
        if (recherche !== undefined && (typeof recherche !== 'string' || recherche.length > 100)) return res.status(400).json({ message: "recherche invalide (100 caractères maximum)." });
        if (!entierPositif(limit) || Number(limit) < 1 || Number(limit) > 200) return res.status(400).json({ message: "limit doit être un entier entre 1 et 200." });
        if (!entierPositif(offset)) return res.status(400).json({ message: "offset doit être un entier positif ou nul." });

        const donnees = await userModel.listUsers({
            role: role || null,
            actif: actif === undefined ? null : actif === 'true',
            recherche: recherche ? recherche.trim() || null : null,
            limit: Number(limit), offset: Number(offset),
        });
        res.status(200).json({ total: donnees.total, limit: Number(limit), offset: Number(offset), resultats: donnees.resultats });
    } catch (error) {
        reponseErreur(error, res);
    }
};

const voirUtilisateur = async (req, res) => {
    try {
        const id = idValide(req, res);
        if (id === null) return;
        const utilisateur = await userModel.getUserById(id);
        if (!utilisateur) return res.status(404).json({ message: "Utilisateur introuvable." });
        const activiteEnCours = await userModel.getImpact(id, aujourdHui());
        res.status(200).json({ ...utilisateur, activite_en_cours: activiteEnCours });
    } catch (error) {
        reponseErreur(error, res);
    }
};

// ---------------------------------------------------------------- Création et modification

const creerUtilisateur = async (req, res) => {
    try {
        const { erreur, valeurs } = validerChamps(req.body || {}, { complet: true });
        if (erreur) return res.status(400).json({ message: erreur });
        if (await userModel.getUserByEmail(valeurs.email)) {
            return res.status(409).json({ message: "Cette adresse email est déjà utilisée." });
        }

        const hash = await bcrypt.hash(valeurs.mot_de_passe, 10);
        // Le compte et sa trace dans l'historique sont créés ensemble : l'un sans l'autre est impossible
        const utilisateur = await enTransaction(async (client) => {
            const u = await userModel.createUser(valeurs.nom, valeurs.prenom, valeurs.email, hash, valeurs.role, client);
            await activite.utilisateurCree(u, req.user.id, client);
            return u;
        });
        res.status(201).json({ message: "Compte créé.", user: utilisateur });
    } catch (error) {
        reponseErreur(error, res);
    }
};

const modifierUtilisateur = async (req, res) => {
    try {
        const id = idValide(req, res);
        if (id === null) return;
        const { erreur, valeurs } = validerChamps(req.body || {}, { complet: false });
        if (erreur) return res.status(400).json({ message: erreur });
        if (Object.keys(valeurs).length === 0) {
            return res.status(400).json({ message: "Indiquez au moins un champ à modifier (nom, prenom, email ou role)." });
        }

        const utilisateur = await enTransaction(async (client) => {
            await userModel.serialiserGestionAdmins(client);
            const avant = await userModel.getUserById(id, client, true);
            if (!avant) throw new ErreurMetier(404, "Utilisateur introuvable.");

            const changements = Object.fromEntries(Object.entries(valeurs).filter(([champ, v]) => avant[champ] !== v));
            if (Object.keys(changements).length === 0) throw new ErreurMetier(400, "Aucun changement : les valeurs indiquées sont déjà celles du compte.");

            if (changements.email && await userModel.emailPris(changements.email, id, client)) {
                throw new ErreurMetier(409, "Cette adresse email est déjà utilisée.");
            }
            if (changements.role) {
                if (id === req.user.id) throw new ErreurMetier(409, "Vous ne pouvez pas modifier votre propre rôle.");
                if (avant.role === 'admin' && avant.actif) {
                    const admins = await userModel.adminsActifs(client);
                    if (!admins.some((a) => a !== id)) throw new ErreurMetier(409, "Impossible : ce compte est le dernier administrateur actif.");
                }
            }

            const apres = await userModel.updateUser(id, changements, client);
            await activite.utilisateurModifie(avant, apres, req.user.id, client);
            return apres;
        });
        res.status(200).json({ message: "Compte modifié.", user: utilisateur });
    } catch (error) {
        reponseErreur(error, res);
    }
};

// ---------------------------------------------------------------- Activation, mot de passe

const desactiverUtilisateur = async (req, res) => {
    try {
        const id = idValide(req, res);
        if (id === null) return;
        const resultat = await enTransaction(async (client) => {
            await userModel.serialiserGestionAdmins(client);
            const avant = await userModel.getUserById(id, client, true);
            if (!avant) throw new ErreurMetier(404, "Utilisateur introuvable.");
            if (!avant.actif) throw new ErreurMetier(400, "Ce compte est déjà désactivé.");
            if (id === req.user.id) throw new ErreurMetier(409, "Vous ne pouvez pas désactiver votre propre compte.");
            if (avant.role === 'admin') {
                const admins = await userModel.adminsActifs(client);
                if (!admins.some((a) => a !== id)) throw new ErreurMetier(409, "Impossible : ce compte est le dernier administrateur actif.");
            }
            const utilisateur = await userModel.setActif(id, false, client);
            // Ce qui reste à faire pour cette personne : à l'admin de le traiter (réaffecter les séances, rejeter les demandes...)
            const impact = await userModel.getImpact(id, aujourdHui(), client);
            await activite.utilisateurDesactive(utilisateur, impact, req.user.id, client);
            return { utilisateur, impact };
        });
        res.status(200).json({ message: "Compte désactivé.", user: resultat.utilisateur, impact: resultat.impact });
    } catch (error) {
        reponseErreur(error, res);
    }
};

const reactiverUtilisateur = async (req, res) => {
    try {
        const id = idValide(req, res);
        if (id === null) return;
        const utilisateur = await enTransaction(async (client) => {
            const avant = await userModel.getUserById(id, client, true);
            if (!avant) throw new ErreurMetier(404, "Utilisateur introuvable.");
            if (avant.actif) throw new ErreurMetier(400, "Ce compte est déjà actif.");
            const u = await userModel.setActif(id, true, client);
            await activite.utilisateurReactive(u, req.user.id, client);
            return u;
        });
        res.status(200).json({ message: "Compte réactivé.", user: utilisateur });
    } catch (error) {
        reponseErreur(error, res);
    }
};

const reinitialiserMotDePasse = async (req, res) => {
    try {
        const id = idValide(req, res);
        if (id === null) return;
        const { mot_de_passe } = req.body || {};
        if (!motDePasseValide(mot_de_passe)) return res.status(400).json({ message: "Le mot de passe doit contenir entre 8 et 72 caractères." });

        const hash = await bcrypt.hash(mot_de_passe, 10);
        await enTransaction(async (client) => {
            const utilisateur = await userModel.getUserById(id, client, true);
            if (!utilisateur) throw new ErreurMetier(404, "Utilisateur introuvable.");
            await userModel.setPassword(id, hash, client);
            await activite.motDePasseReinitialise(id, req.user.id, client);
        });
        res.status(200).json({ message: "Mot de passe réinitialisé." });
    } catch (error) {
        reponseErreur(error, res);
    }
};

module.exports = {
    listerUtilisateurs, voirUtilisateur, creerUtilisateur, modifierUtilisateur,
    desactiverUtilisateur, reactiverUtilisateur, reinitialiserMotDePasse, validerChamps,
};

-- =====================================================================
-- 1. ORGANISATION ACADÉMIQUE
-- =====================================================================

CREATE TABLE niveau (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    libelle      VARCHAR(50) NOT NULL,
    code_niveau  VARCHAR(10) NOT NULL UNIQUE
);

CREATE TABLE filiere (
    id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nom_filiere   VARCHAR(100) NOT NULL,
    code_filiere  VARCHAR(10)  NOT NULL UNIQUE,
    niveau_id     INT NOT NULL REFERENCES niveau(id)
);

CREATE TABLE groupe (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nom_groupe  VARCHAR(50) NOT NULL,
    effectif    INT NOT NULL CHECK (effectif > 0),
    filiere_id  INT NOT NULL REFERENCES filiere(id),
    UNIQUE (filiere_id, nom_groupe)
);

CREATE TABLE module (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nom_module   VARCHAR(100) NOT NULL,
    code_module  VARCHAR(10)  NOT NULL UNIQUE
);


-- =====================================================================
-- 2. UTILISATEURS ET TRAÇABILITÉ
-- =====================================================================

CREATE TABLE utilisateur (
    id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nom           VARCHAR(50)  NOT NULL,
    prenom        VARCHAR(50)  NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,
    mot_de_passe  VARCHAR(255) NOT NULL,
    role          VARCHAR(10)  NOT NULL
                  CHECK (role IN ('admin', 'enseignant')),
    actif         BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE notification (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message        VARCHAR(255) NOT NULL,
    date_creation  TIMESTAMP    NOT NULL DEFAULT NOW(),
    est_lu         BOOLEAN      NOT NULL DEFAULT FALSE,
    utilisateur_id INT          NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE
);

CREATE TABLE historique (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action           VARCHAR(50) NOT NULL,
    entite_concernee VARCHAR(50) NOT NULL,
    id_entite        INT         NOT NULL,
    ancienne_valeur  TEXT,
    nouvelle_valeur  TEXT,
    date_action      TIMESTAMP   NOT NULL DEFAULT NOW(),
    utilisateur_id   INT         NOT NULL REFERENCES utilisateur(id)
);


-- =====================================================================
-- 3. RESSOURCES
-- =====================================================================

CREATE TABLE salle (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nom_salle   VARCHAR(50) NOT NULL UNIQUE,
    capacite    INT         NOT NULL CHECK (capacite > 0),
    type_salle  VARCHAR(20) NOT NULL
                CHECK (type_salle IN ('amphi', 'salle_td', 'salle_tp', 'laboratoire')),
    etat        VARCHAR(20) NOT NULL DEFAULT 'disponible'
                CHECK (etat IN ('disponible', 'en_maintenance', 'indisponible'))
);

CREATE TABLE equipement (
    id              INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nom_equipement  VARCHAR(100) NOT NULL,
    salle_id        INT NOT NULL REFERENCES salle(id) ON DELETE CASCADE
);


-- =====================================================================
-- 4. PLANIFICATION
-- =====================================================================

CREATE TABLE evenement (
    id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    libelle  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE creneau (
    id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date_creneau  DATE,
    jour          VARCHAR(10) NOT NULL
                  CHECK (jour IN ('lundi', 'mardi', 'mercredi', 'jeudi',
                                  'vendredi', 'samedi', 'dimanche')),
    heure_debut   TIME NOT NULL,
    heure_fin     TIME NOT NULL,
    CHECK (heure_fin > heure_debut),
    UNIQUE NULLS NOT DISTINCT (date_creneau, jour, heure_debut, heure_fin)
);

CREATE TABLE edt (
    id                   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    titre                VARCHAR(100) NOT NULL,
    annee_universitaire  VARCHAR(9)   NOT NULL
                         CHECK (annee_universitaire ~ '^[0-9]{4}-[0-9]{4}$'),
    semestre             VARCHAR(10)  NOT NULL,
    date_debut           DATE         NOT NULL,
    date_fin             DATE         NOT NULL,
    date_creation        TIMESTAMP    NOT NULL DEFAULT NOW(),
    filiere_id           INT          NOT NULL REFERENCES filiere(id),
    CHECK (date_fin >= date_debut)
);

CREATE TABLE seance (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    edt_id         INT NOT NULL REFERENCES edt(id) ON DELETE CASCADE,
    enseignant_id  INT NOT NULL REFERENCES utilisateur(id),
    module_id      INT NOT NULL REFERENCES module(id),
    salle_id       INT NOT NULL REFERENCES salle(id),
    creneau_id     INT NOT NULL REFERENCES creneau(id),
    evenement_id   INT NOT NULL REFERENCES evenement(id)
);

CREATE TABLE seance_groupe (
    seance_id  INT NOT NULL REFERENCES seance(id) ON DELETE CASCADE,
    groupe_id  INT NOT NULL REFERENCES groupe(id),
    PRIMARY KEY (seance_id, groupe_id)
);


-- =====================================================================
-- 5. DEMANDES ET CONFLITS
-- =====================================================================

CREATE TABLE reservation (
    id              INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date_demande    TIMESTAMP   NOT NULL DEFAULT NOW(),
    statut          VARCHAR(15) NOT NULL DEFAULT 'en_attente'
                    CHECK (statut IN ('en_attente', 'confirmee', 'rejetee', 'annulee')),
    motif_rejet     VARCHAR(255),
    date_traitement TIMESTAMP,
    enseignant_id   INT NOT NULL REFERENCES utilisateur(id),
    salle_id        INT NOT NULL REFERENCES salle(id),
    creneau_id      INT NOT NULL REFERENCES creneau(id),
    groupe_id       INT REFERENCES groupe(id),
    evenement_id    INT NOT NULL REFERENCES evenement(id),
    admin_id        INT REFERENCES utilisateur(id)
);

CREATE UNIQUE INDEX uq_reservation_confirmee
    ON reservation (salle_id, creneau_id)
    WHERE statut = 'confirmee';

CREATE TABLE demande_changement (
    id                   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date_demande         TIMESTAMP   NOT NULL DEFAULT NOW(),
    type_demande         VARCHAR(25) NOT NULL
                         CHECK (type_demande IN ('annulation_ponctuelle',
                                                 'deplacement_ponctuel',
                                                 'deplacement_definitif')),
    date_occurrence      DATE,
    motif                VARCHAR(255),
    statut               VARCHAR(15) NOT NULL DEFAULT 'en_attente'
                         CHECK (statut IN ('en_attente', 'acceptee', 'refusee')),
    motif_refus          VARCHAR(255),
    date_traitement      TIMESTAMP,
    -- MODIFICATION : ON DELETE CASCADE
    seance_id            INT NOT NULL REFERENCES seance(id) ON DELETE CASCADE,
    enseignant_id        INT NOT NULL REFERENCES utilisateur(id),
    admin_id             INT REFERENCES utilisateur(id),
    nouveau_creneau_id   INT REFERENCES creneau(id),
    nouvelle_salle_id    INT REFERENCES salle(id),
    CHECK (type_demande = 'deplacement_definitif' OR date_occurrence IS NOT NULL),
    CHECK (type_demande = 'annulation_ponctuelle'
           OR nouveau_creneau_id IS NOT NULL
           OR nouvelle_salle_id IS NOT NULL)
);

CREATE TABLE conflit (
    id                     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_conflit           VARCHAR(15) NOT NULL
                           CHECK (type_conflit IN ('salle', 'enseignant', 'groupe', 'capacite')),
    date_detection         TIMESTAMP   NOT NULL DEFAULT NOW(),
    statut                 VARCHAR(10) NOT NULL DEFAULT 'ouvert'
                           CHECK (statut IN ('ouvert', 'resolu')),
    -- MODIFICATION : Ajout de description
    description            VARCHAR(255),
    -- MODIFICATION : ON DELETE CASCADE
    demande_changement_id  INT REFERENCES demande_changement(id) ON DELETE CASCADE
);

CREATE TABLE conflit_reservation (
    conflit_id      INT NOT NULL REFERENCES conflit(id) ON DELETE CASCADE,
    reservation_id  INT NOT NULL REFERENCES reservation(id),
    PRIMARY KEY (conflit_id, reservation_id)
);

-- MODIFICATION : Nouvelle table conflit_demande
CREATE TABLE conflit_demande (
    conflit_id             INT NOT NULL REFERENCES conflit(id) ON DELETE CASCADE,
    demande_changement_id  INT NOT NULL REFERENCES demande_changement(id) ON DELETE CASCADE,
    PRIMARY KEY (conflit_id, demande_changement_id)
);
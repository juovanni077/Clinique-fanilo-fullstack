# Clinique Fanilo — projet complet (backend + frontend)

Application de gestion de clinique médicale avec 4 rôles (admin, médecin,
infirmière, patient), un vrai serveur API, une vraie base de données, et une
authentification par mots de passe hachés + jetons de connexion (JWT).

Ce dossier contient deux projets séparés qu'il faut lancer **tous les deux, en
même temps, dans deux terminaux différents** :

```
clinique-fanilo-fullstack/
├── server/     ← API Node.js / Express + base SQLite
└── client/     ← interface React (Vite + Tailwind)
```

## Prérequis

- [Node.js](https://nodejs.org) version 18 ou plus récente. Vérifie avec :
  ```
  node -v
  ```

## Étape 1 — Lancer le serveur (API)

Dans un premier terminal :

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Au premier lancement, le serveur crée automatiquement le fichier de base de
données `clinique.db` et l'ensemence avec les comptes de démonstration
(mots de passe déjà hachés — jamais stockés en clair).

Tu dois voir :
```
Clinique Fanilo — API démarrée sur http://localhost:4000
```

Laisse ce terminal ouvert.

⚠️ Avant tout déploiement réel (pas juste un test local), ouvre `server/.env`
et remplace `JWT_SECRET` par une vraie valeur aléatoire — voir le commentaire
dans `.env.example` pour la commande qui en génère une.

## Étape 2 — Lancer le frontend (interface)

Dans un **second** terminal :

```bash
cd client
npm install
npm run dev
```

Une adresse s'affiche, généralement `http://localhost:5173`. Ouvre-la dans ton
navigateur.

## Se connecter

Utilise un des comptes de démonstration affichés sur l'écran de connexion :

| Rôle | Email | Mot de passe |
|---|---|---|
| Administrateur | juovann35@gmail.com | admin123 |
| Médecin | voahangy@gmail.com | medecin123 |
| Infirmière | fara@gmail.com | infirmiere123 |
| Patient | nirina@gmail.com | patient123 |

## Ce qui est réellement différent de la version précédente (sans backend)

- **Mots de passe hachés** avec bcrypt — jamais stockés ni transmis en clair,
  y compris dans la base de données elle-même.
- **Authentification par jeton (JWT)** : après connexion, chaque appel au
  serveur est vérifié et associé à un rôle. Impossible de lire les données
  d'un autre patient en trafiquant le code du navigateur.
- **Vraie base de données SQLite** (fichier `server/clinique.db`) : les
  données survivent aux redémarrages, sont interrogeables, sauvegardables.
- **Données partagées en temps réel entre postes** : un médecin sur un
  ordinateur et un patient sur son téléphone voient (après rafraîchissement)
  les mêmes rendez-vous, parce que tout transite par le même serveur.
- **Contrôle d'accès appliqué côté serveur**, pas seulement caché côté
  interface : chaque route de l'API vérifie le rôle avant de répondre.

## Sécurité et conformité (deuxième vague)

- **Journal d'audit** (`GET /api/audit-log`, réservé à l'administrateur) :
  chaque connexion, chaque consultation de dossier patient, chaque création
  ou modification de donnée sensible est enregistrée avec qui, quoi, quand.
  Le dossier d'un patient ne peut plus être consulté "en masse" — il faut
  passer par `GET /api/patients/:id/dossier`, systématiquement journalisé.
- **Validation stricte côté serveur** (`server/src/utils/validate.js`) sur
  tous les formulaires : emails, dates, statuts, longueurs de champs — le
  serveur ne fait plus confiance à ce que lui envoie le navigateur.
- **Limitation des tentatives de connexion** : 8 essais par 15 minutes et
  par IP sur `/api/auth/login`, pour freiner une attaque par force brute.

## Fonctionnalités métier ajoutées

- **Disponibilités des médecins** : chaque médecin définit ses horaires
  hebdomadaires et ses jours d'absence (page "Mes disponibilités"). La
  prise de rendez-vous ne propose plus que les créneaux réellement libres
  (30 min), et le serveur refuse toute réservation hors horaires.
- **Calendrier visuel** : bascule "Liste / Calendrier" sur la page
  Rendez-vous, avec navigation mois par mois et un point coloré par
  rendez-vous (couleur = statut).
- **Graphique d'évolution** : tension et poids affichés sous forme de
  courbe dans le dossier patient (vu par le personnel ou par le patient
  lui-même), pour visualiser une tendance dans le temps.
- **Photo de profil** : chacun peut ajouter sa photo (recadrée et
  compressée automatiquement dans le navigateur) depuis "Mon profil" ;
  l'administrateur peut aussi en définir une à la création d'un compte.
- **Vraie recherche serveur** pour l'infirmière sur la liste des patients
  (interroge toute la base, pas seulement ce qui est déjà chargé en
  mémoire).

- **Détection de conflits d'horaires** : impossible pour un même médecin
  d'avoir deux rendez-vous actifs sur le même créneau — vérifié à la
  création du rendez-vous et à sa confirmation.
- **Notifications** : un système in-app fonctionnel (cloche en haut de
  l'écran) prévient patient et médecin à chaque étape d'un rendez-vous.
  Si tu renseignes des identifiants SMTP dans `server/.env`, de vrais emails
  sont aussi envoyés. Un vrai envoi de SMS demande un compte chez un
  fournisseur payant (Twilio, par exemple) — le point d'intégration est
  prêt dans `server/src/utils/notify.js` (fonction `sendSmsIfConfigured`).
- **Facturation** : l'administrateur peut émettre des factures liées à un
  patient ; le patient les consulte dans "Mes factures". Le règlement est
  enregistré manuellement (espèces, mobile money...) — un vrai paiement en
  ligne nécessiterait un compte Stripe ou équivalent.
- **Pharmacie interne** : stock de médicaments consultable par le personnel
  soignant, décrémenté automatiquement à chaque ordonnance créée (par
  rapprochement du nom du médicament), alerte visuelle en cas de stock bas.
- **Export PDF d'ordonnance**, généré à la volée et téléchargeable depuis le
  dossier patient ou l'espace du patient lui-même.
- **Recherche** : les médecins et infirmières peuvent chercher un patient
  par nom, groupe sanguin ou allergies directement dans leur liste.
- **Corbeille des comptes** : supprimer un compte (admin) ne l'efface plus
  définitivement — il part dans une corbeille (`Personnel & patients` →
  bouton "Corbeille"), restaurable à tout moment. Une suppression
  définitive reste possible depuis la corbeille, en double confirmation.
  L'historique médical (rendez-vous, consultations...) n'est jamais cassé
  par cette suppression, puisque le compte existe toujours en base tant
  qu'il n'est pas purgé définitivement.
- **Assistant IA par rôle** : une bulle de chat (en bas à gauche de l'écran,
  visible sur toutes les pages) propulsée par Google Gemini. Chaque rôle a
  son propre contexte et ses propres garde-fous :
  - Admin : statistiques de la clinique, aide à la navigation.
  - Médecin : aide à la rédaction de notes, questions médicales générales,
    ses prochains rendez-vous — ne pose jamais de diagnostic à sa place.
  - Infirmière : questions de soins générales, interprétation de tendances
    de constantes.
  - Patient : questions de santé générales avec des règles strictes (jamais
    de diagnostic ferme, jamais de posologie au-delà de ce qui est déjà
    prescrit, renvoi systématique vers une consultation ou les urgences en
    cas de symptôme sérieux), personnalisées avec ses allergies connues.
  Voir la section variables d'environnement ci-dessous pour l'activer —
  sans clé API, la bulle reste visible mais affiche un message clair au
  lieu de planter.

## Variables d'environnement (server/.env)

Voir `server/.env.example` pour la liste complète et commentée. En résumé :
- `JWT_SECRET` — à changer avant toute mise en service réelle.
- `SMTP_*` — facultatif, active l'envoi de vrais emails si renseigné.
- `SMS_PROVIDER_*` — facultatif et non câblé par défaut (voir ci-dessus).
- `GEMINI_API_KEY` — facultatif, active l'assistant IA. Clé gratuite sur
  [aistudio.google.com](https://aistudio.google.com) (bouton "Get API key",
  aucune carte bancaire requise pour le palier gratuit).


## Ce qui manque encore pour un vrai déploiement en production

Ce projet reste un environnement de **développement local**. Pour un usage
réel avec des données de patients réelles, il faudrait encore :
- Héberger le serveur et la base de données quelque part (Render, Railway,
  Fly.io, VPS...) avec HTTPS obligatoire.
- Remplacer SQLite par une base plus robuste en production multi-utilisateurs
  intensive (PostgreSQL, par exemple) si le volume le justifie.
- Un vrai fournisseur SMS (Twilio...) et de paiement en ligne (Stripe...)
  si ces canaux doivent être réellement actifs, avec leurs propres comptes
  et identifiants.
- Des sauvegardes automatiques de la base de données.
- Des tests automatisés et une revue de code.
- Faire relire l'ensemble par quelqu'un de spécialisé en sécurité et en
  conformité des données de santé avant toute mise en service réelle.

Parles-en à Claude quand tu voudras passer à cette étape.

## Structure détaillée

```
server/
├── .env.example          variables d'environnement à copier en .env
├── package.json
├── clinique.db            (créé automatiquement au premier lancement)
└── src/
    ├── server.js           point d'entrée Express
    ├── db.js               schéma SQLite + données de démonstration
    ├── middleware/
    │   ├── auth.js          vérification JWT + contrôle des rôles
    │   └── rateLimit.js     limitation de débit (connexion + API globale)
    ├── utils/
    │   ├── mappers.js       conversion base de données → JSON public
    │   ├── validate.js      validation stricte des données entrantes
    │   ├── audit.js         écriture dans le journal d'audit
    │   └── notify.js        notifications in-app + email + point SMS
    └── routes/
        ├── auth.js          connexion, session
        ├── users.js         comptes (admin, médecins, infirmières, patients)
        ├── patients.js      dossier patient consolidé (audité) + recherche
        ├── appointments.js  rendez-vous (avec détection de conflits)
        ├── consultations.js consultations médicales
        ├── prescriptions.js ordonnances + export PDF
        ├── vitals.js        constantes vitales
        ├── notifications.js notifications in-app
        ├── invoices.js      facturation
        ├── medications.js   stock de pharmacie
        ├── auditLog.js      consultation du journal d'audit (admin)
        ├── chat.js          assistant IA par rôle (Google Gemini)
        └── availability.js  disponibilités et absences des médecins

client/
├── index.html
├── package.json
├── vite.config.js / tailwind.config.js / postcss.config.js
└── src/
    ├── main.jsx        démarre l'application React
    ├── api.js           client HTTP vers le serveur (jeton, requêtes)
    ├── ClinicApp.jsx     toute la logique et l'interface
    └── index.css         styles Tailwind + polices
```

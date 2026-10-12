const rateLimit = require("express-rate-limit");

// Sur la connexion : au plus 20 tentatives ÉCHOUÉES par 10 minutes pour une
// même IP. Les connexions réussies ne comptent pas dans la limite —
// c'est volontaire : on ne veut freiner que les tentatives de devinette
// de mot de passe, pas pénaliser quelqu'un qui se reconnecte normalement
// plusieurs fois de suite (test, changement de compte, etc.).
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Trop de tentatives de connexion échouées. Réessaie dans quelques minutes." },
});
// Limite générale sur toute l'API, pour éviter qu'un client (bogué ou
// malveillant) ne submerge le serveur.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes. Merci de réessayer un peu plus tard." },
});

// Limite dédiée au chatbot : c'est un appel vers une API externe (quota
// gratuit partagé), donc on la protège spécifiquement contre les abus,
// en plus de la limite générale ci-dessus.
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de messages envoyés à l'assistant. Réessaie dans quelques minutes." },
});

module.exports = { loginLimiter, apiLimiter, chatLimiter };

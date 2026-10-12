require("dotenv").config();
const express = require("express");
const cors = require("cors");

require("./db"); // initialise et, si besoin, ensemence la base

const { apiLimiter, loginLimiter, chatLimiter } = require("./middleware/rateLimit");

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const patientsRoutes = require("./routes/patients");
const appointmentsRoutes = require("./routes/appointments");
const consultationsRoutes = require("./routes/consultations");
const prescriptionsRoutes = require("./routes/prescriptions");
const vitalsRoutes = require("./routes/vitals");
const notificationsRoutes = require("./routes/notifications");
const invoicesRoutes = require("./routes/invoices");
const medicationsRoutes = require("./routes/medications");
const auditLogRoutes = require("./routes/auditLog");
const chatRoutes = require("./routes/chat");
const availabilityRoutes = require("./routes/availability");

const app = express();

// Nécessaire pour que req.ip reflète la vraie IP du client une fois déployé
// derrière un proxy inverse (Render, Railway, Nginx...).
app.set("trust proxy", 1);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());
app.use("/api", apiLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "clinique-fanilo-api" }));

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/patients", patientsRoutes);
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/consultations", consultationsRoutes);
app.use("/api/prescriptions", prescriptionsRoutes);
app.use("/api/vitals", vitalsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/medications", medicationsRoutes);
app.use("/api/audit-log", auditLogRoutes);
app.use("/api/chat", chatLimiter, chatRoutes);
app.use("/api/availability", availabilityRoutes);

app.use((req, res) => res.status(404).json({ error: "Route inconnue." }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Clinique Fanilo — API démarrée sur http://localhost:${PORT}`);
});

// Filet de sécurité : si une erreur asynchrone échappe à tous les
// try/catch (ex. un flux qui plante), on la logue clairement au lieu de
// laisser le process mourir en silence sans explication dans le terminal.
process.on("uncaughtException", (err) => {
  console.error("Exception non interceptée :", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Promesse rejetée non interceptée :", err);
});

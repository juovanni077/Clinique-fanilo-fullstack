import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Stethoscope, Users, Calendar, ClipboardList, Pill, Activity,
  LogOut, Plus, X, Check, ChevronRight, Search, User, Trash2,
  Edit3, Clock, AlertCircle, FileText, HeartPulse, Shield,
  LayoutDashboard, UserPlus, CalendarPlus, CalendarCheck, Thermometer,
  Receipt, Package, ShieldCheck, Bell, Download, Loader2, Sun, Moon, Eye, EyeOff,
  MessageCircle, Send, Bot, Maximize2, Minimize2, ImagePlus
} from "lucide-react";
import { api } from "./api.js";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const ROLE_LABELS = {
  admin: "Administrateur",
  medecin: "Médecin",
  infirmiere: "Infirmière",
  patient: "Patient",
};

const ROLE_COLORS = {
  admin: "bg-slate-800 text-white",
  medecin: "bg-teal-800 text-white",
  infirmiere: "bg-rose-700 text-white",
  patient: "bg-amber-700 text-white",
};

/**
 * Table simplifiée de familles d'allergies pour une alerte de premier
 * niveau lors de la prescription. Ce n'est PAS une base pharmacologique
 * complète (pas d'interactions médicamenteuses, pas de contre-indications
 * croisées au-delà de ces familles) — un vrai logiciel médical utiliserait
 * une base de données de référence. Ceci reste une aide, pas un substitut
 * au jugement du médecin.
 */
const ALLERGY_FAMILIES = {
  "pénicilline": ["pénicilline", "amoxicilline", "ampicilline", "augmentin", "amoxil"],
  "aspirine": ["aspirine", "acide acétylsalicylique"],
  "sulfamides": ["sulfamide", "sulfaméthoxazole", "bactrim", "cotrimoxazole"],
  "iode": ["iode", "produit de contraste iodé"],
  "latex": ["latex"],
};

function normalizeText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Redimensionne et compresse une image choisie par l'utilisateur avant de
 * l'envoyer au serveur — sans ça, une photo de smartphone (plusieurs Mo)
 * dépasserait largement la limite de 300 Ko côté serveur. On la réduit à
 * un carré de 256px max, en JPEG compressé.
 */
function resizeImageToDataUrl(file, maxSize = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("Le fichier choisi n'est pas une image.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide ou corrompue."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx2d = canvas.getContext("2d");
        ctx2d.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length > 380000) { reject(new Error("Image trop volumineuse même après compression, essaie une autre photo.")); return; }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Vérifie si un médicament (nom saisi par le médecin) recoupe une allergie
 * connue du patient. Retourne le nom de l'allergie concernée, ou null.
 * Détection simple par sous-chaîne + petite table de familles connues —
 * volontairement prudente : en cas de doute elle alerte plutôt que de
 * rester silencieuse, mais elle peut aussi manquer des cas non couverts.
 */
function findAllergyConflict(medName, allergiesText) {
  const med = normalizeText(medName);
  if (!med || !allergiesText) return null;
  const allergies = normalizeText(allergiesText).split(/[,;/]| et /).map((a) => a.trim()).filter(Boolean);

  for (const allergy of allergies) {
    if (!allergy || allergy.includes("aucun")) continue;
    if (med.includes(allergy) || allergy.includes(med)) return allergy;
    for (const [family, members] of Object.entries(ALLERGY_FAMILIES)) {
      const familyNorm = members.map(normalizeText);
      if (familyNorm.some((m) => allergy.includes(m)) && familyNorm.some((m) => med.includes(m))) {
        return allergy;
      }
    }
  }
  return null;
}

const SPECIALITES = [
  "Médecine générale", "Cardiologie", "Pédiatrie", "Gynécologie",
  "Dermatologie", "Orthopédie", "Neurologie", "ORL",
];

const SERVICES_INFIRMIERE = [
  "Soins généraux", "Urgences", "Maternité", "Pédiatrie", "Bloc opératoire",
];

const GROUPES_SANGUINS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
// Formatage manuel du montant (espace normale entre les milliers) plutôt que
// toLocaleString("fr-FR"), dont le séparateur spécial s'affichait mal
// (notamment dans le PDF, où la police ne le reconnaissait pas).
const fmtMontant = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");


/* ------------------------------------------------------------------ */
/* Small UI atoms                                                     */
/* ------------------------------------------------------------------ */

function Badge({ children, tone = "stone" }) {
  const tones = {
    stone: "fx-surface-2 fx-text-2 fx-border border",
    teal: "bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800",
    amber: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
    rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
    slate: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${tones[tone]}`}>
      {children}
    </span>
  );
}

function statutTone(statut) {
  return { "planifié": "amber", "confirmé": "teal", "terminé": "emerald", "annulé": "rose" }[statut] || "stone";
}

function Field({ label, children, required }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium fx-text-2 mb-1">
        {label}{required && <span className="text-rose-600 dark:text-rose-400"> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls = "fx-input w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700";

function PasswordInput({ id, value, onChange, placeholder, required }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        className={inputCls}
        style={{ paddingRight: "2.25rem" }}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 fx-text-muted hover:opacity-70"
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", type = "button", size = "md", disabled, className = "" }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { md: "px-4 py-2 text-sm", sm: "px-3 py-1.5 text-xs" };
  const variants = {
    primary: "bg-teal-800 text-white hover:bg-teal-900",
    secondary: "fx-surface fx-text fx-border border fx-hover",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "fx-text-2 fx-hover",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  // Ferme sur Échap, et verrouille le scroll de la page derrière le modal
  // (sinon on peut scroller le fond pendant qu'une longue fiche est ouverte,
  // ce qui donne l'impression que l'appli est bloquée).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-stone-900/50 flex items-start sm:items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`fx-surface rounded-2xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} my-4 sm:my-8 max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b fx-border sticky top-0 fx-surface rounded-t-2xl z-10">
          <h3 className="font-serif-display text-lg fx-text pr-4">{title}</h3>
          <button onClick={onClose} className="fx-text-muted hover:opacity-70 shrink-0" aria-label="Fermer">
            <X size={20} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 fx-text-muted">
      <Icon size={32} className="mb-2" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function Avatar({ user, size = 40, className = "" }) {
  if (user?.photo) {
    return (
      <img
        src={user.photo}
        alt={user.nom || ""}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const txt = (user?.nom || "?").split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className={`rounded-full flex items-center justify-center font-medium shrink-0 bg-teal-50 dark:bg-teal-950 text-teal-800 dark:text-teal-300 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {txt}
    </div>
  );
}

/**
 * Champ d'upload de photo réutilisable : aperçu rond + bouton de
 * sélection + bouton pour retirer. `value` est un data URL (ou null),
 * `onChange(dataUrlOrNull)` est appelé une fois l'image compressée.
 */
function PhotoUploadField({ value, onChange, nom }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de rechoisir le même fichier ensuite
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err.message || "Impossible de traiter cette image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4 mb-4">
      <Avatar user={{ photo: value, nom: nom || "?" }} size={64} />
      <div>
        <div className="flex gap-2">
          <Btn type="button" variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {value ? "Changer la photo" : "Ajouter une photo"}
          </Btn>
          {value && (
            <Btn type="button" variant="ghost" size="sm" onClick={() => onChange(null)}><Trash2 size={14} className="text-rose-500" /></Btn>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        {error && <p className="text-rose-600 dark:text-rose-400 text-xs mt-1.5 flex items-center gap-1"><AlertCircle size={12} /> {error}</p>}
        <p className="text-xs fx-text-muted mt-1">JPG ou PNG, recadrée et compressée automatiquement.</p>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }) {
  const tones = {
    teal: "bg-teal-800 text-white",
    amber: "bg-amber-700 text-white",
    rose: "bg-rose-700 text-white",
    slate: "bg-slate-800 text-white",
  };
  return (
    <div className="fx-surface rounded-2xl border fx-border p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-2xl font-serif-display fx-text leading-none">{value}</p>
        <p className="text-xs fx-text-2 mt-1">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login screen                                                       */
/* ------------------------------------------------------------------ */

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(err.message || "Email ou mot de passe incorrect.");
    } finally {
      setSubmitting(false);
    }
  };

  const demoAccounts = [
    { role: "Administrateur", email: "juovann35@gmail.com", password: "admin123" },
    { role: "Médecin", email: "voahangy@gmail.com", password: "medecin123" },
    { role: "Infirmière", email: "fara@gmail.com", password: "infirmiere123" },
    { role: "Patient", email: "nirina@gmail.com", password: "patient123" },
  ];

  return (
    <div className="min-h-screen fx-page flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-3xl overflow-hidden shadow-xl border fx-border">
        <div className="bg-teal-900 text-white p-10 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-xl bg-teal-800 border border-teal-700 flex items-center justify-center mb-6">
              <Stethoscope size={24} />
            </div>
            <h1 className="font-serif-display text-3xl leading-tight mb-3">Clinique Fanilo</h1>
            <p className="text-teal-100 text-sm leading-relaxed max-w-xs">
              Plateforme interne de gestion des consultations, du personnel soignant et des dossiers patients.
            </p>
          </div>
          <div className="space-y-2 mt-10">
            <p className="text-xs uppercase tracking-wide text-teal-300 mb-2">Comptes de démonstration</p>
            {demoAccounts.map((a) => (
              <button
                key={a.email}
                onClick={() => { setEmail(a.email); setPassword(a.password); setError(""); }}
                className="w-full text-left text-xs bg-teal-800/60 hover:bg-teal-800 border border-teal-700 rounded-lg px-3 py-2 flex items-center justify-between transition-colors"
              >
                <span>{a.role}</span>
                <span className="text-teal-300">{a.email}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="fx-surface p-10 flex flex-col justify-center">
          <h2 className="font-serif-display text-2xl fx-text mb-1">Connexion</h2>
          <p className="text-sm fx-text-2 mb-6">Accédez à votre espace selon votre rôle.</p>
          <form onSubmit={submit}>
            <Field label="Adresse email" required>
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@gmail.com" />
            </Field>
            <Field label="Mot de passe" required>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
            {error && (
              <p className="text-rose-600 dark:text-rose-400 text-sm mb-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>
            )}
            <Btn type="submit" disabled={submitting} className="w-full mt-2">
              {submitting ? "Connexion…" : <>Se connecter <ChevronRight size={16} /></>}
            </Btn>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar / Shell                                                    */
/* ------------------------------------------------------------------ */

const NAV_BY_ROLE = {
  admin: [
    { id: "dashboard", label: "Vue d'ensemble", icon: LayoutDashboard },
    { id: "users", label: "Personnel & patients", icon: Users },
    { id: "appointments", label: "Rendez-vous", icon: Calendar },
    { id: "invoices", label: "Facturation", icon: Receipt },
    { id: "medications", label: "Pharmacie", icon: Package },
    { id: "audit", label: "Journal d'audit", icon: ShieldCheck },
    { id: "profile", label: "Mon profil", icon: User },
  ],
  medecin: [
    { id: "dashboard", label: "Aujourd'hui", icon: LayoutDashboard },
    { id: "appointments", label: "Mon planning", icon: Calendar },
    { id: "patients", label: "Mes patients", icon: Users },
    { id: "availability", label: "Mes disponibilités", icon: Clock },
    { id: "medications", label: "Pharmacie", icon: Package },
    { id: "profile", label: "Mon profil", icon: User },
  ],
  infirmiere: [
    { id: "dashboard", label: "Aujourd'hui", icon: LayoutDashboard },
    { id: "patients", label: "Patients", icon: Users },
    { id: "vitals", label: "Constantes", icon: HeartPulse },
    { id: "medications", label: "Pharmacie", icon: Package },
    { id: "profile", label: "Mon profil", icon: User },
  ],
  patient: [
    { id: "dashboard", label: "Mon espace", icon: LayoutDashboard },
    { id: "book", label: "Prendre RDV", icon: CalendarPlus },
    { id: "appointments", label: "Mes rendez-vous", icon: Calendar },
    { id: "record", label: "Mon dossier médical", icon: FileText },
    { id: "invoices", label: "Mes factures", icon: Receipt },
    { id: "profile", label: "Mon profil", icon: User },
  ],
};

function Sidebar({ user, page, setPage, onLogout, darkMode, onToggleDarkMode }) {
  const items = NAV_BY_ROLE[user.role];
  return (
    <div className="w-60 shrink-0 bg-stone-900 text-stone-200 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-stone-800">
        <div className="w-8 h-8 rounded-lg bg-teal-700 flex items-center justify-center">
          <Stethoscope size={16} className="text-white" />
        </div>
        <span className="font-serif-display text-lg text-white">Fanilo</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((it) => {
          const Icon = it.icon;
          const active = page === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setPage(it.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? ROLE_COLORS[user.role] : "fx-text-muted hover:bg-stone-800 hover:text-stone-100"
              }`}
            >
              <Icon size={16} />
              {it.label}
            </button>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-stone-800">
        <button
          onClick={() => setPage("profile")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 mb-2 rounded-lg text-left transition-colors ${
            page === "profile" ? ROLE_COLORS[user.role] : "hover:bg-stone-800"
          }`}
        >
          <Avatar user={user} size={32} />
          <div className="min-w-0">
            <p className="text-sm text-stone-100 truncate">{user.nom}</p>
            <p className="text-xs text-stone-400">{ROLE_LABELS[user.role]}</p>
          </div>
        </button>
        <button onClick={onLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm fx-text-muted hover:bg-stone-800 hover:text-rose-300">
          <LogOut size={16} /> Déconnexion
        </button>
        <button onClick={onToggleDarkMode} className="w-full flex items-center gap-2.5 px-3 py-2 mt-1 rounded-lg text-sm fx-text-muted hover:bg-stone-800 hover:text-stone-100">
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          {darkMode ? "Thème clair" : "Thème sombre"}
        </button>
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle, action, accent }) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        {accent && (
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent.className}`}>
            <accent.icon size={18} />
          </div>
        )}
        <div>
          <h1 className="font-serif-display text-2xl fx-text">{title}</h1>
          {subtitle && <p className="text-sm fx-text-2 mt-1">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Patient dossier (shared view used by every role)                   */
/* ------------------------------------------------------------------ */

/**
 * Petit graphique d'évolution en SVG (sans dépendance externe) : trace la
 * tension (systolique) et le poids dans le temps. Chaque courbe utilise sa
 * propre échelle (les unités sont très différentes), donc c'est la
 * TENDANCE qui compte, pas la comparaison directe entre les deux courbes.
 */
function VitalsChart({ vitals }) {
  const points = [...vitals]
    .filter((v) => v.tension || v.poids)
    .sort((a, b) => a.date.localeCompare(b.date));

  // En dessous de 2 mesures on ne peut pas tracer de courbe — on le dit
  // explicitement plutôt que de ne rien afficher (ça donnait l'impression
  // que le graphe était cassé).
  if (points.length < 2) {
    return (
      <div className="fx-surface rounded-2xl border fx-border p-4 mb-5 max-w-xl">
        <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-1">Évolution</h4>
        <p className="text-sm fx-text-muted">
          {points.length === 0 ? "Aucune constante enregistrée pour le moment." : "Au moins deux mesures sont nécessaires pour tracer une courbe d'évolution."}
        </p>
      </div>
    );
  }

  const W = 520, H = 160, PAD = 28;
  const xFor = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);

  const series = (key) => points.map((p) => {
    if (key === "tension") {
      const sys = parseInt(String(p.tension || "").split("/")[0], 10);
      return Number.isFinite(sys) ? sys : null;
    }
    const val = parseFloat(p.poids);
    return Number.isFinite(val) ? val : null;
  });

  const buildPath = (values) => {
    const valid = values.filter((v) => v !== null);
    if (valid.length < 2) return null;
    const min = Math.min(...valid), max = Math.max(...valid);
    const range = max - min || 1;
    const yFor = (v) => H - PAD - ((v - min) / range) * (H - 2 * PAD);
    let d = "";
    values.forEach((v, i) => {
      if (v === null) return;
      d += (d ? " L " : "M ") + xFor(i) + " " + yFor(v);
    });
    return { d, last: values[values.length - 1], lastY: values[values.length - 1] !== null ? yFor(values[values.length - 1]) : null };
  };

  const tensionPath = buildPath(series("tension"));
  const poidsPath = buildPath(series("poids"));

  return (
    <div className="fx-surface rounded-2xl border fx-border p-4 mb-5 max-w-xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted">Évolution</h4>
        <div className="flex items-center gap-3 text-xs">
          {tensionPath && <span className="flex items-center gap-1 fx-text-2"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Tension (systolique)</span>}
          {poidsPath && <span className="flex items-center gap-1 fx-text-2"><span className="w-2.5 h-2.5 rounded-full bg-teal-600 inline-block" /> Poids</span>}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="currentColor" className="fx-text-muted" strokeWidth="1" opacity="0.3" />
        {tensionPath && <path d={tensionPath.d} fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {poidsPath && <path d={poidsPath.d} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <text key={i} x={xFor(i)} y={H - 6} fontSize="8" textAnchor="middle" fill="currentColor" className="fx-text-muted">
            {fmtDate(p.date).replace(/\s\d{4}$/, "")}
          </text>
        ))}
      </svg>
    </div>
  );
}

function PatientDossier({ patientId, ctx, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    ctx.getPatientDossier(patientId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Impossible de charger le dossier."); });
    return () => { cancelled = true; };
  }, [patientId]);

  const medOf = (id) => ctx.users.find((u) => u.id === id);

  const downloadPdf = async (rxId) => {
    setDownloadingId(rxId);
    try { await api.downloadPrescriptionPdf(rxId); }
    catch (e) { ctx.pushToast("error", e.message); }
    finally { setDownloadingId(null); }
  };

  if (error) {
    return (
      <Modal title="Dossier patient" onClose={onClose}>
        <p className="text-rose-600 dark:text-rose-400 text-sm flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>
      </Modal>
    );
  }
  if (!data) {
    return (
      <Modal title="Dossier patient" onClose={onClose}>
        <div className="flex items-center gap-2 fx-text-muted text-sm py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Chargement du dossier…
        </div>
      </Modal>
    );
  }

  const { patient, consultations: consults, prescriptions: rx, vitals: vit } = data;

  return (
    <Modal title={`Dossier — ${patient.nom}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
        <div><span className="fx-text-muted">Né(e) le</span><br />{fmtDate(patient.dateNaissance)}</div>
        <div><span className="fx-text-muted">Sexe</span><br />{patient.sexe === "F" ? "Féminin" : "Masculin"}</div>
        <div><span className="fx-text-muted">Groupe sanguin</span><br />{patient.groupeSanguin || "—"}</div>
        <div><span className="fx-text-muted">Allergies</span><br />{patient.allergies || "Aucune connue"}</div>
        <div><span className="fx-text-muted">Téléphone</span><br />{patient.telephone || "—"}</div>
        <div><span className="fx-text-muted">Adresse</span><br />{patient.adresse || "—"}</div>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-2">Consultations</h4>
      {consults.length === 0 ? (
        <p className="text-sm fx-text-muted mb-5">Aucune consultation enregistrée.</p>
      ) : (
        <div className="space-y-2 mb-5">
          {consults.map((c) => (
            <div key={c.id} className="border fx-border rounded-lg p-3">
              <div className="flex justify-between text-xs fx-text-muted mb-1">
                <span>{fmtDate(c.date)}</span>
                <span>{medOf(c.medecinId)?.nom}</span>
              </div>
              <p className="text-sm font-medium fx-text">{c.diagnostic}</p>
              {c.notes && <p className="text-sm fx-text-2 mt-1">{c.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-2">Ordonnances</h4>
      {rx.length === 0 ? (
        <p className="text-sm fx-text-muted mb-5">Aucune ordonnance.</p>
      ) : (
        <div className="space-y-2 mb-5">
          {rx.map((p) => (
            <div key={p.id} className="border fx-border rounded-lg p-3">
              <div className="flex justify-between text-xs fx-text-muted mb-2">
                <span>{fmtDate(p.date)}</span>
                <span>{medOf(p.medecinId)?.nom}</span>
              </div>
              <ul className="text-sm fx-text list-disc pl-4 space-y-0.5">
                {p.medicaments.map((m, i) => (
                  <li key={i}>{m.nom} — {m.dosage}, {m.frequence}, {m.duree}</li>
                ))}
              </ul>
              {p.instructions && <p className="text-xs fx-text-2 mt-2 italic">{p.instructions}</p>}
              <button
                onClick={() => downloadPdf(p.id)}
                disabled={downloadingId === p.id}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-800 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 font-medium disabled:opacity-50"
              >
                {downloadingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {downloadingId === p.id ? "Génération…" : "Télécharger en PDF"}
              </button>
            </div>
          ))}
        </div>
      )}

      <VitalsChart vitals={vit} />

      <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-2">Constantes vitales</h4>
      {vit.length === 0 ? (
        <p className="text-sm fx-text-muted">Aucune mesure enregistrée.</p>
      ) : (
        <div className="space-y-2">
          {vit.map((v) => (
            <div key={v.id} className="border fx-border rounded-lg p-3 text-sm">
              <div className="flex justify-between text-xs fx-text-muted mb-1">
                <span>{fmtDate(v.date)}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 fx-text">
                <span>TA: {v.tension}</span>
                <span>T°: {v.temperature}</span>
                <span>Pouls: {v.pouls}</span>
                <span>Poids: {v.poids}kg</span>
              </div>
              {v.notes && <p className="text-xs fx-text-2 mt-1">{v.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* ADMIN pages                                                        */
/* ------------------------------------------------------------------ */

function AdminDashboard({ ctx }) {
  const { users, appointments } = ctx;
  const patients = users.filter((u) => u.role === "patient");
  const medecins = users.filter((u) => u.role === "medecin");
  const infirmieres = users.filter((u) => u.role === "infirmiere");
  const today = todayISO();
  const rdvAujourdhui = appointments.filter((a) => a.date === today);
  const recent = [...appointments].sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure)).slice(0, 6);
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";

  return (
    <div>
      <PageHeader title="Vue d'ensemble" subtitle="Activité générale de la clinique" accent={{ icon: Shield, className: ROLE_COLORS.admin }} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label="Patients enregistrés" value={patients.length} tone="teal" />
        <StatCard icon={Stethoscope} label="Médecins" value={medecins.length} tone="slate" />
        <StatCard icon={HeartPulse} label="Infirmières" value={infirmieres.length} tone="rose" />
        <StatCard icon={Calendar} label="RDV aujourd'hui" value={rdvAujourdhui.length} tone="amber" />
      </div>
      <div className="fx-surface rounded-2xl border fx-border p-5">
        <h3 className="font-serif-display text-lg fx-text mb-4">Activité récente</h3>
        {recent.length === 0 ? (
          <EmptyState icon={Calendar} text="Aucun rendez-vous enregistré." />
        ) : (
          <div className="divide-y fx-divide">
            {recent.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm fx-text">{nameOf(a.patientId)} <span className="fx-text-muted">avec</span> {nameOf(a.medecinId)}</p>
                  <p className="text-xs fx-text-muted mt-0.5">{fmtDate(a.date)} à {a.heure} · {a.motif}</p>
                </div>
                <Badge tone={statutTone(a.statut)}>{a.statut}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial ? { ...initial, password: "" } : { role: "patient", nom: "", email: "", password: "", telephone: "", specialite: SPECIALITES[0], service: SERVICES_INFIRMIERE[0], dateNaissance: "", sexe: "F", groupeSanguin: "", allergies: "", adresse: "", photo: null }
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.nom || !form.email) { setError("Le nom et l'email sont obligatoires."); return; }
    if (!initial && !form.password) { setError("Le mot de passe est obligatoire pour un nouveau compte."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer ce compte.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PhotoUploadField value={form.photo} onChange={(photo) => setForm({ ...form, photo })} nom={form.nom} />
      <Field label="Rôle" required>
        <select className={inputCls} value={form.role} onChange={set("role")} disabled={!!initial}>
          <option value="patient">Patient</option>
          <option value="medecin">Médecin</option>
          <option value="infirmiere">Infirmière</option>
          <option value="admin">Administrateur</option>
        </select>
      </Field>
      <Field label="Nom complet" required>
        <input className={inputCls} value={form.nom} onChange={set("nom")} placeholder="Ex : Dr. Herimanana Rakoto" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" required>
          <input className={inputCls} type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label={initial ? "Nouveau mot de passe (laisser vide pour ne pas changer)" : "Mot de passe"} required={!initial}>
          <PasswordInput value={form.password} onChange={set("password")} placeholder={initial ? "••••••••" : ""} />
        </Field>
      </div>
      <Field label="Téléphone">
        <input className={inputCls} value={form.telephone} onChange={set("telephone")} placeholder="034 00 000 00" />
      </Field>

      {form.role === "medecin" && (
        <Field label="Spécialité">
          <select className={inputCls} value={form.specialite} onChange={set("specialite")}>
            {SPECIALITES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      )}
      {form.role === "infirmiere" && (
        <Field label="Service">
          <select className={inputCls} value={form.service} onChange={set("service")}>
            {SERVICES_INFIRMIERE.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      )}
      {form.role === "patient" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de naissance">
              <input className={inputCls} type="date" value={form.dateNaissance} onChange={set("dateNaissance")} />
            </Field>
            <Field label="Sexe">
              <select className={inputCls} value={form.sexe} onChange={set("sexe")}>
                <option value="F">Féminin</option>
                <option value="M">Masculin</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Groupe sanguin">
              <select className={inputCls} value={form.groupeSanguin} onChange={set("groupeSanguin")}>
                <option value="">— Choisir —</option>
                {GROUPES_SANGUINS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Allergies">
              <input className={inputCls} value={form.allergies} onChange={set("allergies")} placeholder="Aucune connue" />
            </Field>
          </div>
          <Field label="Adresse">
            <input className={inputCls} value={form.adresse} onChange={set("adresse")} />
          </Field>
        </>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <Btn variant="secondary" onClick={onCancel} disabled={saving}>Annuler</Btn>
        <Btn type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Btn>
      </div>
      {error && <p className="text-rose-600 dark:text-rose-400 text-sm mt-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>}
    </form>
  );
}

function UsersPage({ ctx }) {
  const [filter, setFilter] = useState("tous");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [viewPatient, setViewPatient] = useState(null);
  const [showTrash, setShowTrash] = useState(false);

  const list = ctx.users.filter((u) => {
    if (filter !== "tous" && u.role !== filter) return false;
    if (search && !u.nom.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const saveUser = async (form) => {
    const isEdit = !!editUser;
    if (isEdit) {
      await ctx.updateUser(editUser.id, form);
    } else {
      await ctx.addUser(form);
    }
    setFormOpen(false);
    setEditUser(null);
    ctx.pushToast("success", isEdit ? `Compte de ${form.nom} modifié avec succès.` : `Compte de ${form.nom} créé avec succès.`);
  };

  const handleDeleteUser = async (u) => {
    if (!window.confirm(`Déplacer le compte de ${u.nom} vers la corbeille ? Il pourra être restauré ensuite.`)) return;
    try {
      await ctx.deleteUser(u.id);
      ctx.pushToast("success", `Compte de ${u.nom} déplacé vers la corbeille.`);
    } catch (err) {
      ctx.pushToast("error", err.message || "Impossible de supprimer ce compte.");
    }
  };

  if (showTrash) {
    return <TrashView ctx={ctx} onBack={() => setShowTrash(false)} />;
  }

  return (
    <div>
      <PageHeader
        title="Personnel & patients"
        subtitle={`${ctx.users.length} comptes au total`}
        action={
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowTrash(true)}><Trash2 size={16} /> Corbeille</Btn>
            <Btn onClick={() => { setEditUser(null); setFormOpen(true); }}><UserPlus size={16} /> Nouveau compte</Btn>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {["tous", "medecin", "infirmiere", "patient", "admin"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === f ? "bg-teal-800 text-white border-teal-800" : "fx-surface fx-text-2 fx-border-strong fx-hover"
            }`}
          >
            {f === "tous" ? "Tous" : ROLE_LABELS[f] + "s"}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search size={14} className="absolute left-2.5 top-2.5 fx-text-muted" />
          <input className={`${inputCls} pl-8 w-56`} placeholder="Rechercher un nom…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="fx-surface rounded-2xl border fx-border overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={Users} text="Aucun compte ne correspond à ce filtre." />
        ) : (
          <table className="w-full text-sm">
            <thead className="fx-surface-2 fx-text-2 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Nom</th>
                <th className="text-left px-5 py-3 font-medium">Rôle</th>
                <th className="text-left px-5 py-3 font-medium">Détail</th>
                <th className="text-left px-5 py-3 font-medium">Contact</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y fx-divide">
              {list.map((u) => (
                <tr key={u.id} className="fx-hover">
                  <td className="px-5 py-3 fx-text font-medium">{u.nom}</td>
                  <td className="px-5 py-3"><Badge tone={{ admin: "slate", medecin: "teal", infirmiere: "rose", patient: "amber" }[u.role]}>{ROLE_LABELS[u.role]}</Badge></td>
                  <td className="px-5 py-3 fx-text-2">{u.specialite || u.service || (u.role === "patient" ? `${u.groupeSanguin || "—"}` : "—")}</td>
                  <td className="px-5 py-3 fx-text-2">{u.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      {u.role === "patient" && (
                        <Btn size="sm" variant="ghost" onClick={() => setViewPatient(u)}><FileText size={14} /></Btn>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => { setEditUser(u); setFormOpen(true); }}><Edit3 size={14} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDeleteUser(u)}><Trash2 size={14} className="text-rose-500" /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <Modal title={editUser ? "Modifier le compte" : "Nouveau compte"} onClose={() => { setFormOpen(false); setEditUser(null); }} wide>
          <UserForm initial={editUser} onSave={saveUser} onCancel={() => { setFormOpen(false); setEditUser(null); }} />
        </Modal>
      )}
      {viewPatient && <PatientDossier patientId={viewPatient.id} ctx={ctx} onClose={() => setViewPatient(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Corbeille des comptes supprimés                                    */
/* ------------------------------------------------------------------ */

function TrashView({ ctx, onBack }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setItems(null);
    api.listTrash().then(setItems).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const restore = async (u) => {
    setBusyId(u.id);
    try {
      await ctx.restoreUser(u.id);
      ctx.pushToast("success", `Compte de ${u.nom} restauré.`);
      setItems((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e) {
      ctx.pushToast("error", e.message);
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (u) => {
    if (!window.confirm(`Supprimer DÉFINITIVEMENT le compte de ${u.nom} ? Cette action est totalement irréversible — impossible de revenir en arrière.`)) return;
    setBusyId(u.id);
    try {
      await api.purgeUser(u.id);
      ctx.pushToast("success", `Compte de ${u.nom} supprimé définitivement.`);
      setItems((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e) {
      ctx.pushToast("error", e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Corbeille"
        subtitle="Comptes supprimés — restaurables tant qu'ils ne sont pas purgés définitivement"
        action={<Btn variant="secondary" onClick={onBack}><ChevronRight size={16} className="rotate-180" /> Retour</Btn>}
      />
      <div className="fx-surface rounded-2xl border fx-border overflow-hidden">
        {error ? (
          <p className="p-5 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : !items ? (
          <div className="flex items-center gap-2 fx-text-muted text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
        ) : items.length === 0 ? (
          <EmptyState icon={Trash2} text="La corbeille est vide." />
        ) : (
          <div className="divide-y fx-divide">
            {items.map((u) => (
              <div key={u.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium fx-text">{u.nom} <Badge tone={{ admin: "slate", medecin: "teal", infirmiere: "rose", patient: "amber" }[u.role]}>{ROLE_LABELS[u.role]}</Badge></p>
                  <p className="text-xs fx-text-muted mt-0.5">{u.email} · supprimé le {fmtDate(u.deletedAt?.slice(0, 10))}</p>
                </div>
                <div className="flex gap-2">
                  <Btn size="sm" variant="secondary" disabled={busyId === u.id} onClick={() => restore(u)}>
                    {busyId === u.id ? "…" : "Restaurer"}
                  </Btn>
                  <Btn size="sm" variant="danger" disabled={busyId === u.id} onClick={() => purge(u)}>
                    Supprimer définitivement
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Appointments (shared across roles, behaviour differs)              */
/* ------------------------------------------------------------------ */

const STATUT_DOT = { "planifié": "bg-amber-500", "confirmé": "bg-teal-600", "terminé": "bg-emerald-600", "annulé": "bg-rose-500" };

function MonthCalendar({ appointments, renderDay }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDate, setSelectedDate] = useState(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = dimanche
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayISO();

  const byDate = {};
  appointments.forEach((a) => { (byDate[a.date] = byDate[a.date] || []).push(a); });

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const monthLabel = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const selectedList = selectedDate ? (byDate[selectedDate] || []) : [];

  return (
    <div>
      <div className="fx-surface rounded-2xl border fx-border p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1.5 rounded-lg fx-hover fx-text-2"><ChevronRight size={16} className="rotate-180" /></button>
          <p className="text-sm font-medium fx-text capitalize">{monthLabel}</p>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1.5 rounded-lg fx-hover fx-text-2"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs fx-text-muted mb-1">
          {["D", "L", "M", "M", "J", "V", "S"].map((j, i) => <div key={i} className="py-1">{j}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const ds = dateStr(d);
            const dayAppts = byDate[ds] || [];
            const isToday = ds === todayStr;
            const isSelected = ds === selectedDate;
            return (
              <button
                key={i}
                onClick={() => setSelectedDate(ds === selectedDate ? null : ds)}
                className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 border transition-colors ${
                  isSelected ? "bg-teal-800 text-white border-teal-800" : isToday ? "fx-surface-2 fx-text border-teal-600" : "fx-surface fx-text-2 fx-border hover:opacity-80"
                }`}
              >
                <span>{d}</span>
                {dayAppts.length > 0 && (
                  <span className="flex gap-0.5">
                    {dayAppts.slice(0, 3).map((a, idx) => (
                      <span key={idx} className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : STATUT_DOT[a.statut] || "bg-stone-400"}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="fx-surface rounded-2xl border fx-border overflow-hidden mt-4">
          <div className="px-5 py-3 border-b fx-border">
            <p className="text-sm font-medium fx-text">{fmtDate(selectedDate)}</p>
          </div>
          {selectedList.length === 0 ? (
            <EmptyState icon={Calendar} text="Aucun rendez-vous ce jour-là." />
          ) : (
            <div className="divide-y fx-divide">
              {selectedList.sort((a, b) => a.heure.localeCompare(b.heure)).map(renderDay)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AppointmentsPage({ ctx }) {
  const { user } = ctx;
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";
  const [consultFor, setConsultFor] = useState(null);
  const [statusFilter, setStatusFilter] = useState("tous");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [viewMode, setViewMode] = useState("liste");

  let list = ctx.appointments;
  if (user.role === "medecin") list = list.filter((a) => a.medecinId === user.id);
  if (user.role === "patient") list = list.filter((a) => a.patientId === user.id);
  if (statusFilter !== "tous") list = list.filter((a) => a.statut === statusFilter);
  list = [...list].sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));

  const changeStatus = async (id, statut) => {
    setBusyId(id);
    setError("");
    try {
      await ctx.updateAppointment(id, { statut });
    } catch (err) {
      // Ex : conflit d'horaire détecté par le serveur au moment de confirmer.
      setError(err.message || "Impossible de mettre à jour ce rendez-vous.");
    } finally {
      setBusyId(null);
    }
  };

  const appointmentRow = (a) => (
    <div key={a.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm fx-text font-medium">
          {fmtDate(a.date)} · {a.heure}
        </p>
        <p className="text-xs fx-text-2 mt-0.5">
          {user.role === "patient" ? nameOf(a.medecinId) : nameOf(a.patientId)} — {a.motif}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={statutTone(a.statut)}>{a.statut}</Badge>
        {user.role === "medecin" && a.statut === "planifié" && (
          <Btn size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => changeStatus(a.id, "confirmé")}>
            {busyId === a.id ? "…" : "Confirmer"}
          </Btn>
        )}
        {user.role === "medecin" && (a.statut === "planifié" || a.statut === "confirmé") && (
          <Btn size="sm" onClick={() => setConsultFor(a)}>Consultation</Btn>
        )}
        {user.role === "patient" && (a.statut === "planifié" || a.statut === "confirmé") && (
          <Btn size="sm" variant="danger" disabled={busyId === a.id} onClick={() => changeStatus(a.id, "annulé")}>
            {busyId === a.id ? "…" : "Annuler"}
          </Btn>
        )}
        {(user.role === "admin" || user.role === "infirmiere") && (a.statut === "planifié") && (
          <Btn size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => changeStatus(a.id, "confirmé")}>
            {busyId === a.id ? "…" : "Confirmer"}
          </Btn>
        )}
        {(user.role === "admin" || user.role === "infirmiere" || user.role === "medecin") && (a.statut === "planifié" || a.statut === "confirmé") && (
          <Btn size="sm" variant="danger" disabled={busyId === a.id} onClick={() => { if (window.confirm("Annuler ce rendez-vous ?")) changeStatus(a.id, "annulé"); }}>
            {busyId === a.id ? "…" : "Annuler"}
          </Btn>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={user.role === "patient" ? "Mes rendez-vous" : user.role === "medecin" ? "Mon planning" : "Rendez-vous"}
        subtitle={`${list.length} rendez-vous`}
        action={
          <div className="flex rounded-lg border fx-border overflow-hidden text-xs font-medium">
            <button onClick={() => setViewMode("liste")} className={`px-3 py-1.5 ${viewMode === "liste" ? "bg-teal-800 text-white" : "fx-surface fx-text-2"}`}>Liste</button>
            <button onClick={() => setViewMode("calendrier")} className={`px-3 py-1.5 ${viewMode === "calendrier" ? "bg-teal-800 text-white" : "fx-surface fx-text-2"}`}>Calendrier</button>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {["tous", "planifié", "confirmé", "terminé", "annulé"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === s ? "bg-teal-800 text-white border-teal-800" : "fx-surface fx-text-2 fx-border-strong fx-hover"}`}>
            {s === "tous" ? "Tous" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-rose-600 dark:text-rose-400 text-sm mb-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>
      )}

      {viewMode === "calendrier" ? (
        <MonthCalendar appointments={list} renderDay={appointmentRow} nameOf={nameOf} role={user.role} />
      ) : (
      <div className="fx-surface rounded-2xl border fx-border overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={Calendar} text="Aucun rendez-vous à afficher." />
        ) : (
          <div className="divide-y fx-divide">
            {list.map(appointmentRow)}
          </div>
        )}
      </div>
      )}
      {consultFor && (
        <ConsultationModal appointment={consultFor} ctx={ctx} onClose={() => setConsultFor(null)} />
      )}
    </div>
  );
}

function ConsultationModal({ appointment, ctx, onClose }) {
  const patient = ctx.users.find((u) => u.id === appointment.patientId);
  const [diagnostic, setDiagnostic] = useState("");
  const [notes, setNotes] = useState("");
  const [meds, setMeds] = useState([{ medicationId: "", nom: "", dosage: "", frequence: "", duree: "" }]);
  const [instructions, setInstructions] = useState("");
  const pharmacy = ctx.medications || [];

  const setMed = (i, k, v) => {
    const next = [...meds];
    next[i] = { ...next[i], [k]: v };
    setMeds(next);
  };
  const selectMed = (i, medicationId) => {
    const next = [...meds];
    if (medicationId === "__custom__") {
      next[i] = { ...next[i], medicationId: "", nom: "" };
    } else {
      const found = pharmacy.find((m) => m.id === medicationId);
      next[i] = { ...next[i], medicationId, nom: found ? found.nom : "" };
    }
    setMeds(next);
  };
  const addMedRow = () => setMeds([...meds, { medicationId: "", nom: "", dosage: "", frequence: "", duree: "" }]);
  const removeMedRow = (i) => setMeds(meds.filter((_, idx) => idx !== i));

  const allergyConflicts = meds
    .map((m) => (m.nom.trim() ? { med: m.nom.trim(), allergy: findAllergyConflict(m.nom, patient.allergies) } : null))
    .filter((c) => c && c.allergy);

  const stockWarnings = meds
    .filter((m) => m.medicationId)
    .map((m) => pharmacy.find((p) => p.id === m.medicationId))
    .filter((p) => p && p.stock <= 0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!diagnostic) return;
    if (allergyConflicts.length > 0) {
      const names = allergyConflicts.map((c) => c.med).join(", ");
      if (!window.confirm(`Attention : ${names} pourrait concerner une allergie connue du patient. Confirmer quand même la prescription ?`)) {
        return;
      }
    }
    if (stockWarnings.length > 0) {
      const names = stockWarnings.map((p) => p.nom).join(", ");
      if (!window.confirm(`Attention : ${names} n'a plus de stock à la pharmacie. Prescrire quand même ?`)) {
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      // On attend la consultation créée par le serveur avant de créer
      // l'ordonnance, car c'est lui qui attribue l'identifiant définitif
      // (nécessaire pour bien relier l'ordonnance à cette consultation).
      const createdConsultation = await ctx.addConsultation({
        patientId: patient.id, medecinId: appointment.medecinId,
        appointmentId: appointment.id, diagnostic, notes,
      });
      const validMeds = meds.filter((m) => m.nom.trim());
      if (validMeds.length > 0) {
        await ctx.addPrescription({
          patientId: patient.id, medecinId: appointment.medecinId,
          consultationId: createdConsultation.id, medicaments: validMeds, instructions,
        });
      }
      await ctx.updateAppointment(appointment.id, { statut: "terminé" });
      onClose();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer la consultation.");
      setSaving(false);
    }
  };

  return (
    <Modal title={`Consultation — ${patient?.nom}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Diagnostic" required>
          <input className={inputCls} value={diagnostic} onChange={(e) => setDiagnostic(e.target.value)} placeholder="Ex : Hypertension légère" />
        </Field>
        <Field label="Notes de consultation">
          <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, recommandations…" />
        </Field>

        <div className="flex items-center justify-between mt-4 mb-2">
          <span className="text-sm font-medium fx-text-2">Ordonnance (facultatif)</span>
          <Btn type="button" size="sm" variant="secondary" onClick={addMedRow}><Plus size={14} /> Médicament</Btn>
        </div>
        {patient.allergies && !patient.allergies.toLowerCase().includes("aucun") && (
          <p className="text-xs fx-text-2 mb-2 flex items-center gap-1.5">
            <AlertCircle size={13} /> Allergies connues du patient : <span className="font-medium fx-text">{patient.allergies}</span>
          </p>
        )}
        {allergyConflicts.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 mb-3 text-sm flex items-start gap-2 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>
              {allergyConflicts.map((c, i) => (
                <p key={i}>
                  Attention : <span className="font-medium">{c.med}</span> pourrait être concerné par l'allergie connue du patient à <span className="font-medium">{c.allergy}</span>.
                </p>
              ))}
              <p className="text-xs mt-1 opacity-80">Vérifie avant de confirmer — cette détection automatique est une aide, pas une garantie.</p>
            </div>
          </div>
        )}
        <div className="space-y-2 mb-3">
          {meds.map((m, i) => {
            const selected = m.medicationId ? pharmacy.find((p) => p.id === m.medicationId) : null;
            const isCustom = !m.medicationId;
            return (
              <div key={i}>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <select
                    className={`${inputCls} col-span-4`}
                    value={m.medicationId || "__custom__"}
                    onChange={(e) => selectMed(i, e.target.value)}
                  >
                    <option value="__custom__">— Saisie libre (hors stock) —</option>
                    {pharmacy.map((p) => (
                      <option key={p.id} value={p.id}>{p.nom} ({p.stock} {p.unite} en stock)</option>
                    ))}
                  </select>
                  {isCustom ? (
                    <input className={`${inputCls} col-span-3`} placeholder="Nom du médicament" value={m.nom} onChange={(e) => setMed(i, "nom", e.target.value)} />
                  ) : (
                    <div className={`${inputCls} col-span-3 flex items-center fx-text-2 truncate`} title={m.nom}>{m.nom}</div>
                  )}
                  <input className={`${inputCls} col-span-2`} placeholder="Dosage" value={m.dosage} onChange={(e) => setMed(i, "dosage", e.target.value)} />
                  <input className={`${inputCls} col-span-2`} placeholder="Fréquence" value={m.frequence} onChange={(e) => setMed(i, "frequence", e.target.value)} />
                  <button type="button" onClick={() => removeMedRow(i)} className="col-span-1 fx-text-muted hover:text-rose-500"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-12 gap-2 mt-1">
                  <input className={`${inputCls} col-span-4 col-start-1`} placeholder="Durée (ex : 7 jours)" value={m.duree} onChange={(e) => setMed(i, "duree", e.target.value)} />
                  {selected && selected.stock <= 0 && (
                    <p className="col-span-8 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertCircle size={12} /> Stock épuisé à la pharmacie.</p>
                  )}
                  {selected && selected.stock > 0 && selected.stock <= selected.seuilAlerte && (
                    <p className="col-span-8 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertCircle size={12} /> Stock faible ({selected.stock} {selected.unite} restant{selected.stock > 1 ? "s" : ""}).</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs fx-text-muted mb-3">
          Choisir un médicament dans le stock décrémente automatiquement la pharmacie. La « saisie libre » n'affecte pas le stock.
        </p>
        <Field label="Instructions au patient">
          <input className={inputCls} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ex : à prendre après le repas" />
        </Field>

        {error && (
          <p className="text-rose-600 dark:text-rose-400 text-sm mt-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Annuler</Btn>
          <Btn type="submit" disabled={saving}><Check size={16} /> {saving ? "Enregistrement…" : "Clôturer la consultation"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Médecin — mes patients                                             */
/* ------------------------------------------------------------------ */

function MedecinPatientsPage({ ctx }) {
  const patientIds = new Set(ctx.appointments.filter((a) => a.medecinId === ctx.user.id).map((a) => a.patientId));
  const allPatients = ctx.users.filter((u) => u.role === "patient" && patientIds.has(u.id));
  const [view, setView] = useState(null);
  const [q, setQ] = useState("");
  const patients = q.trim()
    ? allPatients.filter((p) => (p.nom + " " + (p.groupeSanguin || "") + " " + (p.allergies || "")).toLowerCase().includes(q.toLowerCase()))
    : allPatients;

  return (
    <div>
      <PageHeader
        title="Mes patients"
        subtitle={`${allPatients.length} patient(s) suivi(s)`}
        action={
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 fx-text-muted" />
            <input className={`${inputCls} pl-8 w-56`} placeholder="Rechercher un patient…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      {patients.length === 0 ? (
        <EmptyState icon={Users} text="Aucun patient ne correspond." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {patients.map((p) => (
            <button key={p.id} onClick={() => setView(p)} className="fx-surface rounded-2xl border fx-border p-5 text-left hover:border-teal-700 transition-colors">
              <Avatar user={p} size={40} className="mb-3" />
              <p className="font-medium fx-text">{p.nom}</p>
              <p className="text-xs fx-text-2 mt-1">{p.sexe === "F" ? "Féminin" : "Masculin"} · né(e) le {fmtDate(p.dateNaissance)}</p>
            </button>
          ))}
        </div>
      )}
      {view && <PatientDossier patientId={view.id} ctx={ctx} onClose={() => setView(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Infirmière — patients + constantes                                 */
/* ------------------------------------------------------------------ */

function NursePatientsPage({ ctx }) {
  const allPatients = ctx.users.filter((u) => u.role === "patient");
  const [view, setView] = useState(null);
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  // Recherche côté serveur (sur toute la base, pas seulement les patients
  // déjà chargés en mémoire) — avec un léger délai pour ne pas envoyer une
  // requête à chaque frappe.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const timeout = setTimeout(() => {
      api.searchPatients(query)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [q]);

  const patients = searchResults !== null ? searchResults : allPatients;

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={`${allPatients.length} patient(s) enregistré(s)`}
        action={
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 fx-text-muted" />
            <input className={`${inputCls} pl-8 w-56`} placeholder="Rechercher un patient…" value={q} onChange={(e) => setQ(e.target.value)} />
            {searching && <Loader2 size={14} className="animate-spin absolute right-2.5 top-2.5 fx-text-muted" />}
          </div>
        }
      />
      {patients.length === 0 ? (
        <EmptyState icon={Users} text="Aucun patient ne correspond." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {patients.map((p) => (
            <button key={p.id} onClick={() => setView(p)} className="fx-surface rounded-2xl border fx-border p-5 text-left hover:border-rose-600 transition-colors">
              <Avatar user={p} size={40} className="mb-3" />
              <p className="font-medium fx-text">{p.nom}</p>
              <p className="text-xs fx-text-2 mt-1">GS {p.groupeSanguin || "—"} · Allergies : {p.allergies || "aucune"}</p>
            </button>
          ))}
        </div>
      )}
      {view && <PatientDossier patientId={view.id} ctx={ctx} onClose={() => setView(null)} />}
    </div>
  );
}

function VitalsPage({ ctx }) {
  const patients = ctx.users.filter((u) => u.role === "patient");
  const [patientId, setPatientId] = useState(patients[0]?.id || "");
  const [tension, setTension] = useState("");
  const [temperature, setTemperature] = useState("");
  const [pouls, setPouls] = useState("");
  const [poids, setPoids] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmMsg, setConfirmMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const recent = ctx.vitals.filter((v) => v.infirmiereId === ctx.user.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";

  const submit = async (e) => {
    e.preventDefault();
    if (!patientId || !tension || !pouls) return;
    setSaving(true);
    setError("");
    try {
      await ctx.addVitals({ patientId, tension, temperature, pouls, poids, notes });
      setTension(""); setTemperature(""); setPouls(""); setPoids(""); setNotes("");
      setConfirmMsg("Constantes enregistrées.");
      setTimeout(() => setConfirmMsg(""), 2500);
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer ces constantes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Constantes vitales" subtitle="Enregistrer une mesure pour un patient" />
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="fx-surface rounded-2xl border fx-border p-5">
          <form onSubmit={submit}>
            <Field label="Patient" required>
              <select className={inputCls} value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patients.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tension (ex 12/8)" required>
                <input className={inputCls} value={tension} onChange={(e) => setTension(e.target.value)} />
              </Field>
              <Field label="Température (°C)">
                <input className={inputCls} value={temperature} onChange={(e) => setTemperature(e.target.value)} />
              </Field>
              <Field label="Pouls (bpm)" required>
                <input className={inputCls} value={pouls} onChange={(e) => setPouls(e.target.value)} />
              </Field>
              <Field label="Poids (kg)">
                <input className={inputCls} value={poids} onChange={(e) => setPoids(e.target.value)} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Btn type="submit" disabled={saving} className="w-full mt-1"><Thermometer size={16} /> {saving ? "Enregistrement…" : "Enregistrer la mesure"}</Btn>
            {error && <p className="text-rose-600 dark:text-rose-400 text-sm mt-2 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>}
            {confirmMsg && <p className="text-emerald-700 dark:text-emerald-400 text-sm mt-2 flex items-center gap-1.5"><Check size={14} /> {confirmMsg}</p>}
          </form>
        </div>
        <div className="fx-surface rounded-2xl border fx-border p-5">
          <h3 className="font-serif-display text-lg fx-text mb-3">Mes dernières mesures</h3>
          {recent.length === 0 ? (
            <EmptyState icon={HeartPulse} text="Aucune mesure enregistrée pour l'instant." />
          ) : (
            <div className="space-y-2">
              {recent.map((v) => (
                <div key={v.id} className="border fx-border rounded-lg p-3 text-sm">
                  <div className="flex justify-between text-xs fx-text-muted mb-1">
                    <span>{nameOf(v.patientId)}</span><span>{fmtDate(v.date)}</span>
                  </div>
                  <div className="fx-text">TA {v.tension} · T° {v.temperature || "—"} · Pouls {v.pouls} · {v.poids || "—"} kg</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Patient — booking + dashboard + record                             */
/* ------------------------------------------------------------------ */

const JOURS_SEMAINE = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function AvailabilityPage({ ctx }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [jour, setJour] = useState(1);
  const [heureDebut, setHeureDebut] = useState("08:00");
  const [heureFin, setHeureFin] = useState("12:00");
  const [absenceDate, setAbsenceDate] = useState("");
  const [absenceMotif, setAbsenceMotif] = useState("");
  const [saving, setSaving] = useState(false);

  const medecinId = ctx.user.id;

  const load = () => {
    api.getAvailability(medecinId).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const addSlot = async (e) => {
    e.preventDefault();
    if (heureDebut >= heureFin) { ctx.pushToast("error", "L'heure de fin doit être après l'heure de début."); return; }
    setSaving(true);
    try {
      await api.addAvailabilitySlot(medecinId, { jourSemaine: jour, heureDebut, heureFin });
      ctx.pushToast("success", "Créneau ajouté.");
      load();
    } catch (err) {
      ctx.pushToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeSlot = async (id) => {
    try {
      await api.deleteAvailabilitySlot(id);
      ctx.pushToast("success", "Créneau retiré.");
      load();
    } catch (err) {
      ctx.pushToast("error", err.message);
    }
  };

  const addAbsence = async (e) => {
    e.preventDefault();
    if (!absenceDate) return;
    setSaving(true);
    try {
      await api.addAbsence(medecinId, { date: absenceDate, motif: absenceMotif || undefined });
      ctx.pushToast("success", "Absence enregistrée.");
      setAbsenceDate(""); setAbsenceMotif("");
      load();
    } catch (err) {
      ctx.pushToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeAbsence = async (id) => {
    try {
      await api.deleteAbsence(id);
      ctx.pushToast("success", "Absence retirée.");
      load();
    } catch (err) {
      ctx.pushToast("error", err.message);
    }
  };

  const slotsByJour = {};
  (data?.slots || []).forEach((s) => {
    (slotsByJour[s.jourSemaine] = slotsByJour[s.jourSemaine] || []).push(s);
  });

  return (
    <div>
      <PageHeader title="Mes disponibilités" subtitle="Définis tes horaires habituels et tes jours d'absence" />
      {error && <p className="text-rose-600 dark:text-rose-400 text-sm mb-3">{error}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="fx-surface rounded-2xl border fx-border p-5">
          <h3 className="font-serif-display text-lg fx-text mb-4">Horaires hebdomadaires</h3>
          <form onSubmit={addSlot} className="flex flex-wrap items-end gap-2 mb-5">
            <div>
              <label className="block text-xs fx-text-2 mb-1">Jour</label>
              <select className={inputCls} value={jour} onChange={(e) => setJour(Number(e.target.value))}>
                {JOURS_SEMAINE.map((j, i) => <option key={i} value={i}>{j}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs fx-text-2 mb-1">Début</label>
              <input className={inputCls} type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs fx-text-2 mb-1">Fin</label>
              <input className={inputCls} type="time" value={heureFin} onChange={(e) => setHeureFin(e.target.value)} />
            </div>
            <Btn type="submit" size="sm" disabled={saving}><Plus size={14} /> Ajouter</Btn>
          </form>

          {!data ? (
            <div className="flex items-center gap-2 fx-text-muted text-sm py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
          ) : (data.slots || []).length === 0 ? (
            <EmptyState icon={Clock} text="Aucun horaire défini pour l'instant." />
          ) : (
            <div className="space-y-3">
              {JOURS_SEMAINE.map((j, i) => (
                slotsByJour[i] ? (
                  <div key={i}>
                    <p className="text-xs font-medium fx-text-2 mb-1">{j}</p>
                    <div className="flex flex-wrap gap-2">
                      {slotsByJour[i].map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1.5 fx-surface-2 fx-text rounded-full px-3 py-1 text-xs border fx-border">
                          {s.heureDebut} – {s.heureFin}
                          <button onClick={() => removeSlot(s.id)} className="fx-text-muted hover:text-rose-500"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          )}
        </div>

        <div className="fx-surface rounded-2xl border fx-border p-5">
          <h3 className="font-serif-display text-lg fx-text mb-4">Jours d'absence</h3>
          <form onSubmit={addAbsence} className="flex flex-wrap items-end gap-2 mb-5">
            <div>
              <label className="block text-xs fx-text-2 mb-1">Date</label>
              <input className={inputCls} type="date" min={todayISO()} value={absenceDate} onChange={(e) => setAbsenceDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="block text-xs fx-text-2 mb-1">Motif (facultatif)</label>
              <input className={inputCls} value={absenceMotif} onChange={(e) => setAbsenceMotif(e.target.value)} placeholder="Congé, formation…" />
            </div>
            <Btn type="submit" size="sm" disabled={saving}><Plus size={14} /> Ajouter</Btn>
          </form>

          {!data ? null : (data.absences || []).length === 0 ? (
            <EmptyState icon={Calendar} text="Aucune absence à venir." />
          ) : (
            <div className="space-y-2">
              {data.absences.map((a) => (
                <div key={a.id} className="flex items-center justify-between fx-surface-2 rounded-lg px-3 py-2 text-sm">
                  <span className="fx-text">{fmtDate(a.date)}{a.motif ? ` — ${a.motif}` : ""}</span>
                  <button onClick={() => removeAbsence(a.id)} className="fx-text-muted hover:text-rose-500"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BookAppointmentPage({ ctx }) {
  const medecins = ctx.users.filter((u) => u.role === "medecin");
  const [medecinId, setMedecinId] = useState(medecins[0]?.id || "");
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("");
  const [motif, setMotif] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [slotsInfo, setSlotsInfo] = useState(null); // { configured, slots, absent }
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!medecinId || !date) { setSlotsInfo(null); return; }
    setLoadingSlots(true);
    setHeure("");
    api.getAvailableSlots(medecinId, date)
      .then(setSlotsInfo)
      .catch(() => setSlotsInfo(null))
      .finally(() => setLoadingSlots(false));
  }, [medecinId, date]);

  const submit = async (e) => {
    e.preventDefault();
    if (!medecinId || !date || !motif || !heure) return;
    setSaving(true);
    setError("");
    try {
      await ctx.addAppointment({ medecinId, date, heure, motif });
      setDone(true);
      setDate(""); setMotif(""); setHeure(""); setSlotsInfo(null);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      // Le message du serveur explique déjà clairement le conflit d'horaire
      // (ex : "Dr. X a déjà un rendez-vous à ce créneau…") le cas échéant.
      setError(err.message || "Impossible de créer le rendez-vous.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Prendre rendez-vous" subtitle="Choisissez un médecin et un créneau" />
      <div className="max-w-lg fx-surface rounded-2xl border fx-border p-6">
        <form onSubmit={submit}>
          <Field label="Médecin" required>
            <select className={inputCls} value={medecinId} onChange={(e) => setMedecinId(e.target.value)}>
              {medecins.map((m) => <option key={m.id} value={m.id}>{m.nom} — {m.specialite}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <input className={inputCls} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label="Heure" required>
            {loadingSlots ? (
              <div className={`${inputCls} flex items-center gap-2 fx-text-muted`}><Loader2 size={14} className="animate-spin" /> Chargement des créneaux…</div>
            ) : !date ? (
              <div className={`${inputCls} fx-text-muted`}>Choisis d'abord une date</div>
            ) : slotsInfo?.absent ? (
              <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1.5 py-2"><AlertCircle size={14} /> Ce médecin est absent ce jour-là. Choisis une autre date.</p>
            ) : slotsInfo?.configured ? (
              slotsInfo.slots.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5 py-2"><AlertCircle size={14} /> Plus aucun créneau libre ce jour-là. Essaie une autre date.</p>
              ) : (
                <select className={inputCls} value={heure} onChange={(e) => setHeure(e.target.value)}>
                  <option value="">— Choisir un créneau —</option>
                  {slotsInfo.slots.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )
            ) : (
              // Ce médecin n'a pas encore configuré ses horaires ce jour de
              // la semaine : on ne propose plus de saisie libre de l'heure
              // (ça permettait de contourner ses disponibilités et ses
              // absences). On bloque la prise de RDV et on l'explique.
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5 py-2"><AlertCircle size={14} /> Ce médecin n'a pas d'horaires configurés ce jour-là. Choisis une autre date ou un autre médecin.</p>
            )}
          </Field>

          <Field label="Motif de la consultation" required>
            <textarea className={inputCls} rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Décrivez brièvement le motif de votre visite" />
          </Field>
          {error && (
            <p className="text-rose-600 dark:text-rose-400 text-sm mb-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>
          )}
          <Btn type="submit" disabled={saving || !heure} className="w-full">
            <CalendarPlus size={16} /> {saving ? "Envoi…" : "Confirmer la demande"}
          </Btn>
          {done && <p className="text-emerald-700 dark:text-emerald-400 text-sm mt-3 flex items-center gap-1.5"><Check size={14} /> Rendez-vous demandé avec succès.</p>}
        </form>
      </div>
    </div>
  );
}

function PatientDashboard({ ctx }) {
  const own = ctx.appointments.filter((a) => a.patientId === ctx.user.id);
  const next = own.filter((a) => (a.statut === "planifié" || a.statut === "confirmé") && a.date >= todayISO())
    .sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure))[0];
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";
  const rx = (ctx.ownDossier?.prescriptions || [])[0];

  return (
    <div>
      <PageHeader title={`Bonjour, ${ctx.user.nom.split(" ")[0]}`} subtitle="Voici un aperçu de votre suivi médical" accent={{ icon: User, className: ROLE_COLORS.patient }} />
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="fx-surface rounded-2xl border fx-border p-5">
          <div className="flex items-center gap-2 text-teal-800 dark:text-teal-400 mb-2"><Calendar size={16} /><span className="text-sm font-medium">Prochain rendez-vous</span></div>
          {next ? (
            <>
              <p className="fx-text font-medium">{fmtDate(next.date)} à {next.heure}</p>
              <p className="text-sm fx-text-2 mt-1">avec {nameOf(next.medecinId)} — {next.motif}</p>
              <Badge tone={statutTone(next.statut)}>{next.statut}</Badge>
            </>
          ) : (
            <p className="text-sm fx-text-muted">Aucun rendez-vous à venir.</p>
          )}
        </div>
        <div className="fx-surface rounded-2xl border fx-border p-5">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2"><Pill size={16} /><span className="text-sm font-medium">Dernière ordonnance</span></div>
          {rx ? (
            <>
              <p className="text-sm fx-text-2">{fmtDate(rx.date)}</p>
              <ul className="text-sm fx-text list-disc pl-4 mt-1">
                {rx.medicaments.map((m, i) => <li key={i}>{m.nom} — {m.dosage}</li>)}
              </ul>
            </>
          ) : (
            <p className="text-sm fx-text-muted">Aucune ordonnance récente.</p>
          )}
        </div>
      </div>
      <p className="text-xs fx-text-muted">Groupe sanguin : {ctx.user.groupeSanguin || "—"} · Allergies : {ctx.user.allergies || "aucune connue"}</p>
    </div>
  );
}

function PatientRecordPage({ ctx }) {
  return (
    <div>
      <PageHeader title="Mon dossier médical" subtitle="Historique complet de vos soins" />
      <div className="fx-surface rounded-2xl border fx-border p-6">
        <PatientDossierInline ctx={ctx} />
      </div>
    </div>
  );
}

function PatientDossierInline({ ctx }) {
  const [downloadingId, setDownloadingId] = useState(null);
  if (!ctx.ownDossier) {
    return <div className="flex items-center gap-2 fx-text-muted text-sm py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Chargement…</div>;
  }
  const { consultations: consults, prescriptions: rx, vitals: vit } = ctx.ownDossier;
  const medOf = (id) => ctx.users.find((u) => u.id === id);

  const downloadPdf = async (rxId) => {
    setDownloadingId(rxId);
    try { await api.downloadPrescriptionPdf(rxId); }
    catch (e) { ctx.pushToast("error", e.message); }
    finally { setDownloadingId(null); }
  };

  return (
    <div>
      <VitalsChart vitals={vit} />
      <div className="grid md:grid-cols-3 gap-6">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-2">Consultations</h4>
        {consults.length === 0 ? <p className="text-sm fx-text-muted">Aucune.</p> : (
          <div className="space-y-2">
            {consults.map((c) => (
              <div key={c.id} className="border fx-border rounded-lg p-3">
                <p className="text-xs fx-text-muted mb-1">{fmtDate(c.date)} · {medOf(c.medecinId)?.nom}</p>
                <p className="text-sm font-medium fx-text">{c.diagnostic}</p>
                {c.notes && <p className="text-xs fx-text-2 mt-1">{c.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-2">Ordonnances</h4>
        {rx.length === 0 ? <p className="text-sm fx-text-muted">Aucune.</p> : (
          <div className="space-y-2">
            {rx.map((p) => (
              <div key={p.id} className="border fx-border rounded-lg p-3">
                <p className="text-xs fx-text-muted mb-1">{fmtDate(p.date)} · {medOf(p.medecinId)?.nom}</p>
                <ul className="text-sm fx-text list-disc pl-4">
                  {p.medicaments.map((m, i) => <li key={i}>{m.nom} — {m.dosage}, {m.frequence}, {m.duree}</li>)}
                </ul>
                <button
                  onClick={() => downloadPdf(p.id)}
                  disabled={downloadingId === p.id}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-800 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 font-medium disabled:opacity-50"
                >
                  {downloadingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {downloadingId === p.id ? "Génération…" : "Télécharger en PDF"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide fx-text-muted mb-2">Constantes vitales</h4>
        {vit.length === 0 ? <p className="text-sm fx-text-muted">Aucune.</p> : (
          <div className="space-y-2">
            {vit.map((v) => (
              <div key={v.id} className="border fx-border rounded-lg p-3 text-sm">
                <p className="text-xs fx-text-muted mb-1">{fmtDate(v.date)}</p>
                <p className="fx-text">TA {v.tension} · T° {v.temperature || "—"} · Pouls {v.pouls}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Médecin dashboard                                                  */
/* ------------------------------------------------------------------ */

function MedecinDashboard({ ctx }) {
  const today = todayISO();
  const mine = ctx.appointments.filter((a) => a.medecinId === ctx.user.id);
  const todays = mine.filter((a) => a.date === today).sort((a, b) => a.heure.localeCompare(b.heure));
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";

  return (
    <div>
      <PageHeader title={`Bonjour, ${ctx.user.nom}`} subtitle={ctx.user.specialite} accent={{ icon: Stethoscope, className: ROLE_COLORS.medecin }} />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Calendar} label="RDV aujourd'hui" value={todays.length} tone="teal" />
        <StatCard icon={Users} label="Patients suivis" value={new Set(mine.map((a) => a.patientId)).size} tone="slate" />
        <StatCard icon={ClipboardList} label="En attente" value={mine.filter((a) => a.statut === "planifié").length} tone="amber" />
      </div>
      <div className="fx-surface rounded-2xl border fx-border p-5">
        <h3 className="font-serif-display text-lg fx-text mb-4">Planning du jour</h3>
        {todays.length === 0 ? (
          <EmptyState icon={Clock} text="Aucun rendez-vous prévu aujourd'hui." />
        ) : (
          <div className="divide-y fx-divide">
            {todays.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium fx-text">{a.heure} — {nameOf(a.patientId)}</p>
                  <p className="text-xs fx-text-2">{a.motif}</p>
                </div>
                <Badge tone={statutTone(a.statut)}>{a.statut}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Infirmière dashboard                                               */
/* ------------------------------------------------------------------ */

function InfirmiereDashboard({ ctx }) {
  const today = todayISO();
  const todays = ctx.appointments.filter((a) => a.date === today && (a.statut === "planifié" || a.statut === "confirmé")).sort((a, b) => a.heure.localeCompare(b.heure));
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";
  const myVitalsToday = ctx.vitals.filter((v) => v.infirmiereId === ctx.user.id && v.date === today);

  return (
    <div>
      <PageHeader title={`Bonjour, ${ctx.user.nom.split(" ")[0]}`} subtitle={ctx.user.service} accent={{ icon: HeartPulse, className: ROLE_COLORS.infirmiere }} />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Calendar} label="RDV cliniques aujourd'hui" value={todays.length} tone="rose" />
        <StatCard icon={HeartPulse} label="Mesures prises aujourd'hui" value={myVitalsToday.length} tone="teal" />
        <StatCard icon={Users} label="Patients enregistrés" value={ctx.users.filter((u) => u.role === "patient").length} tone="slate" />
      </div>
      <div className="fx-surface rounded-2xl border fx-border p-5">
        <h3 className="font-serif-display text-lg fx-text mb-4">Rendez-vous du jour (tous services)</h3>
        {todays.length === 0 ? (
          <EmptyState icon={Clock} text="Aucun rendez-vous aujourd'hui." />
        ) : (
          <div className="divide-y fx-divide">
            {todays.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium fx-text">{a.heure} — {nameOf(a.patientId)}</p>
                  <p className="text-xs fx-text-2">avec {nameOf(a.medecinId)} · {a.motif}</p>
                </div>
                <Badge tone={statutTone(a.statut)}>{a.statut}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile page                                                       */
/* ------------------------------------------------------------------ */

function ProfilePage({ ctx }) {
  const u = ctx.user;
  const [savingPhoto, setSavingPhoto] = useState(false);

  const changePhoto = async (photo) => {
    setSavingPhoto(true);
    try {
      await ctx.updateMyPhoto(photo);
      ctx.pushToast("success", photo ? "Photo de profil mise à jour." : "Photo de profil retirée.");
    } catch (err) {
      ctx.pushToast("error", err.message || "Impossible de mettre à jour la photo.");
    } finally {
      setSavingPhoto(false);
    }
  };

  return (
    <div>
      <PageHeader title="Mon profil" />
      <div className="max-w-md fx-surface rounded-2xl border fx-border p-6">
        <PhotoUploadField value={u.photo} onChange={changePhoto} nom={u.nom} />
        {savingPhoto && <p className="text-xs fx-text-muted -mt-2 mb-3 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Enregistrement…</p>}
        <p className="text-lg font-serif-display fx-text">{u.nom}</p>
        <Badge tone="teal">{ROLE_LABELS[u.role]}</Badge>
        <div className="mt-4 space-y-2 text-sm fx-text-2">
          <p><span className="fx-text-muted">Email :</span> {u.email}</p>
          <p><span className="fx-text-muted">Téléphone :</span> {u.telephone || "—"}</p>
          {u.specialite && <p><span className="fx-text-muted">Spécialité :</span> {u.specialite}</p>}
          {u.service && <p><span className="fx-text-muted">Service :</span> {u.service}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Facturation                                                        */
/* ------------------------------------------------------------------ */

function InvoicesPage({ ctx }) {
  const isAdmin = ctx.user.role === "admin";
  const [formOpen, setFormOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || "—";
  const invoiceTone = { "impayé": "amber", "payé": "emerald", "annulé": "rose" };

  const downloadReceipt = async (id) => {
    setDownloadingId(id);
    try { await api.downloadInvoicePdf(id); }
    catch (e) { ctx.pushToast("error", e.message); }
    finally { setDownloadingId(null); }
  };

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Facturation" : "Mes factures"}
        subtitle={`${ctx.invoices.length} facture(s)`}
        action={isAdmin ? <Btn onClick={() => setFormOpen(true)}><Plus size={16} /> Nouvelle facture</Btn> : null}
      />
      <div className="table-card fx-surface rounded-2xl border fx-border overflow-hidden">
        {ctx.invoices.length === 0 ? (
          <EmptyState icon={Receipt} text="Aucune facture pour l'instant." />
        ) : (
          <div className="divide-y fx-divide">
            {ctx.invoices.map((inv) => (
              <div key={inv.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium fx-text">{inv.libelle}</p>
                  <p className="text-xs fx-text-2 mt-0.5">
                    {isAdmin ? `${nameOf(inv.patientId)} · ` : ""}{fmtDate(inv.createdAt?.slice(0, 10))} · {fmtMontant(inv.montant)} {inv.devise}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={invoiceTone[inv.statut]}>{inv.statut}</Badge>
                  {isAdmin && inv.statut === "impayé" && (
                    <Btn size="sm" variant="secondary" onClick={() => ctx.updateInvoice(inv.id, { statut: "payé", modePaiement: "Espèces" }).then(() => ctx.pushToast("success", "Facture marquée comme payée.")).catch((e) => ctx.pushToast("error", e.message))}>Marquer payée</Btn>
                  )}
                  <Btn size="sm" variant="ghost" disabled={downloadingId === inv.id} onClick={() => downloadReceipt(inv.id)}>
                    {downloadingId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {formOpen && <InvoiceFormModal ctx={ctx} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

function InvoiceFormModal({ ctx, onClose }) {
  const patients = ctx.users.filter((u) => u.role === "patient");
  const [patientId, setPatientId] = useState(patients[0]?.id || "");
  const [libelle, setLibelle] = useState("");
  const [montant, setMontant] = useState("");
  const [assurance, setAssurance] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!patientId || !libelle || !montant) return;
    setSaving(true);
    setError("");
    try {
      await ctx.createInvoice({ patientId, libelle, montant: Number(montant), assurance: assurance || undefined });
      ctx.pushToast("success", "Facture créée avec succès.");
      onClose();
    } catch (err) {
      setError(err.message || "Impossible de créer la facture.");
      setSaving(false);
    }
  };

  return (
    <Modal title="Nouvelle facture" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Patient" required>
          <select className={inputCls} value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </Field>
        <Field label="Libellé" required>
          <input className={inputCls} value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Ex : Consultation cardiologie" />
        </Field>
        <Field label="Montant (Ar)" required>
          <input className={inputCls} type="number" min="0" value={montant} onChange={(e) => setMontant(e.target.value)} />
        </Field>
        <Field label="Assurance (facultatif)">
          <input className={inputCls} value={assurance} onChange={(e) => setAssurance(e.target.value)} placeholder="Ex : CNaPS, aucune…" />
        </Field>
        {error && <p className="text-rose-600 dark:text-rose-400 text-sm mb-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Annuler</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Création…" : "Créer la facture"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Pharmacie                                                          */
/* ------------------------------------------------------------------ */

function MedicationsPage({ ctx }) {
  const isAdmin = ctx.user.role === "admin";
  const [formOpen, setFormOpen] = useState(false);
  const [adjustFor, setAdjustFor] = useState(null);

  return (
    <div>
      <PageHeader
        title="Pharmacie"
        subtitle={`${ctx.medications.length} médicament(s) en stock`}
        action={isAdmin ? <Btn onClick={() => setFormOpen(true)}><Plus size={16} /> Ajouter un médicament</Btn> : null}
      />
      <div className="table-card fx-surface rounded-2xl border fx-border overflow-hidden">
        {ctx.medications.length === 0 ? (
          <EmptyState icon={Package} text="Aucun médicament enregistré." />
        ) : (
          <table className="w-full text-sm">
            <thead className="fx-surface-2 fx-text-2 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Médicament</th>
                <th className="text-left px-5 py-3 font-medium">Stock</th>
                <th className="text-left px-5 py-3 font-medium">Statut</th>
                {isAdmin && <th className="text-right px-5 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y fx-divide">
              {ctx.medications.map((m) => {
                const low = m.stock <= m.seuilAlerte;
                return (
                  <tr key={m.id} className="fx-hover">
                    <td className="px-5 py-3 fx-text font-medium">{m.nom}</td>
                    <td className="px-5 py-3 fx-text-2">{m.stock} {m.unite}</td>
                    <td className="px-5 py-3">
                      {low ? <Badge tone="rose">Stock faible</Badge> : <Badge tone="emerald">Disponible</Badge>}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Btn size="sm" variant="secondary" onClick={() => setAdjustFor(m)}>Ajuster le stock</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => { if (window.confirm(`Retirer ${m.nom} du stock ?`)) ctx.deleteMedication(m.id).then(() => ctx.pushToast("success", `${m.nom} retiré du stock.`)).catch((e) => ctx.pushToast("error", e.message)); }}><Trash2 size={14} className="text-rose-500" /></Btn>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {formOpen && <MedicationFormModal ctx={ctx} onClose={() => setFormOpen(false)} />}
      {adjustFor && <AdjustStockModal ctx={ctx} medication={adjustFor} onClose={() => setAdjustFor(null)} />}
    </div>
  );
}

function AdjustStockModal({ ctx, medication, onClose }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const parsed = Number(amount);
  const futureStock = Number.isFinite(parsed) ? medication.stock + parsed : medication.stock;

  const submit = async (e) => {
    e.preventDefault();
    if (!amount || !Number.isFinite(parsed) || parsed === 0) { setError("Indique une quantité (positive pour ajouter, négative pour retirer)."); return; }
    if (futureStock < 0) { setError("Le stock ne peut pas devenir négatif."); return; }
    setSaving(true);
    setError("");
    try {
      await ctx.updateMedication(medication.id, { stock: futureStock });
      ctx.pushToast("success", `Stock de ${medication.nom} mis à jour : ${futureStock} ${medication.unite}.`);
      onClose();
    } catch (err) {
      setError(err.message || "Impossible de mettre à jour le stock.");
      setSaving(false);
    }
  };

  return (
    <Modal title={`Ajuster le stock — ${medication.nom}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm fx-text-2 mb-3">Stock actuel : <span className="font-medium fx-text">{medication.stock} {medication.unite}</span></p>
        <Field label="Quantité à ajouter (mets un nombre négatif pour retirer)" required>
          <input className={inputCls} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex : 50 ou -5" autoFocus />
        </Field>
        {amount && Number.isFinite(parsed) && (
          <p className="text-xs fx-text-2 mb-2">Nouveau stock : <span className="font-medium">{futureStock} {medication.unite}</span></p>
        )}
        {error && <p className="text-rose-600 dark:text-rose-400 text-sm mb-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Annuler</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Mise à jour…" : "Confirmer"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function MedicationFormModal({ ctx, onClose }) {
  const [nom, setNom] = useState("");
  const [unite, setUnite] = useState("boîte");
  const [stock, setStock] = useState("0");
  const [seuil, setSeuil] = useState("10");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!nom.trim()) return;
    setSaving(true);
    setError("");
    try {
      await ctx.createMedication({ nom: nom.trim(), unite, stock: Number(stock), seuilAlerte: Number(seuil) });
      ctx.pushToast("success", `${nom.trim()} ajouté à la pharmacie.`);
      onClose();
    } catch (err) {
      setError(err.message || "Impossible d'ajouter ce médicament.");
      setSaving(false);
    }
  };

  return (
    <Modal title="Ajouter un médicament" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Nom" required>
          <input className={inputCls} value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex : Paracétamol 500 mg" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unité"><input className={inputCls} value={unite} onChange={(e) => setUnite(e.target.value)} /></Field>
          <Field label="Stock initial"><input className={inputCls} type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
          <Field label="Seuil d'alerte"><input className={inputCls} type="number" min="0" value={seuil} onChange={(e) => setSeuil(e.target.value)} /></Field>
        </div>
        {error && <p className="text-rose-600 dark:text-rose-400 text-sm mb-3 flex items-center gap-1.5"><AlertCircle size={14} /> {error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Annuler</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Ajout…" : "Ajouter"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Journal d'audit (admin)                                            */
/* ------------------------------------------------------------------ */

const AUDIT_LABELS = {
  login_success: "Connexion réussie", login_failed: "Échec de connexion",
  view_dossier: "Consultation de dossier", create_appointment: "Création de rendez-vous",
  update_appointment_status: "Changement de statut de rendez-vous", create_consultation: "Création de consultation",
  create_prescription: "Création d'ordonnance", download_prescription_pdf: "Téléchargement d'ordonnance (PDF)",
  create_vitals: "Enregistrement de constantes", create_user: "Création de compte",
  update_user: "Modification de compte", delete_user: "Suppression de compte",
  create_invoice: "Création de facture", update_invoice: "Modification de facture",
  search_consultations: "Recherche dans les consultations",
  create_medication: "Ajout d'un médicament", update_medication: "Modification du stock",
  download_invoice_pdf: "Téléchargement d'un reçu de facture",
  restore_user: "Restauration d'un compte", purge_user: "Suppression définitive d'un compte",
  chat_message: "Message envoyé à l'assistant IA",
};

function AuditLogPage({ ctx }) {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listAuditLog({ limit: 200 }).then(setLogs).catch((e) => setError(e.message));
  }, []);

  const nameOf = (id) => ctx.users.find((u) => u.id === id)?.nom || id;

  return (
    <div>
      <PageHeader title="Journal d'audit" subtitle="Qui a fait quoi, sur quel dossier, et quand" />
      <div className="table-card fx-surface rounded-2xl border fx-border overflow-hidden">
        {error ? (
          <p className="p-5 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : !logs ? (
          <div className="flex items-center gap-2 fx-text-muted text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
        ) : logs.length === 0 ? (
          <EmptyState icon={ShieldCheck} text="Aucun événement enregistré." />
        ) : (
          <div className="divide-y fx-divide max-h-[70vh] overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap text-sm">
                <div>
                  <p className="fx-text">
                    <span className="font-medium">{l.userNom || "Anonyme"}</span>
                    <span className="fx-text-muted"> ({ROLE_LABELS[l.userRole] || l.userRole || "—"})</span>
                    {" — "}{AUDIT_LABELS[l.action] || l.action}
                    {l.targetPatientId && <> · patient : <span className="font-medium">{nameOf(l.targetPatientId)}</span></>}
                  </p>
                  {l.detail && <p className="text-xs fx-text-muted mt-0.5">{l.detail}</p>}
                </div>
                <span className="text-xs fx-text-muted">{fmtDateTime(l.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cloche de notifications                                            */
/* ------------------------------------------------------------------ */

function NotificationBell({ ctx }) {
  const [open, setOpen] = useState(false);
  const unread = ctx.notifications.filter((n) => !n.lu).length;

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative p-2 rounded-lg fx-hover fx-text-2">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-600 text-white text-[10px] leading-none rounded-full w-4 h-4 flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 fx-surface border fx-border rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b fx-border">
              <span className="text-sm font-medium fx-text">Notifications</span>
              {unread > 0 && (
                <button onClick={() => ctx.markAllNotificationsRead()} className="text-xs text-teal-800 dark:text-teal-400 hover:underline">Tout marquer lu</button>
              )}
            </div>
            {ctx.notifications.length === 0 ? (
              <p className="text-sm fx-text-muted px-4 py-6 text-center">Aucune notification.</p>
            ) : (
              ctx.notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.lu && ctx.markNotificationRead(n.id)}
                  className={`w-full text-left px-4 py-3 border-b fx-border last:border-0 ${n.lu ? "opacity-60" : "bg-teal-50/40 dark:bg-teal-950/40"}`}
                >
                  <p className="text-sm font-medium fx-text">{n.titre}</p>
                  <p className="text-xs fx-text-2 mt-0.5">{n.message}</p>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts (notifications de succès / erreur)                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Assistant IA (chatbot par rôle)                                    */
/* ------------------------------------------------------------------ */

const CHAT_GREETINGS = {
  admin: "Bonjour ! Je peux répondre à tes questions sur le fonctionnement de la clinique (rendez-vous, personnel, facturation, pharmacie) ou t'aider à naviguer dans l'application.",
  medecin: "Bonjour Docteur. Je peux vous aider à formuler des notes de consultation, discuter de questions médicales générales, ou vous rappeler vos prochains rendez-vous.",
  infirmiere: "Bonjour ! Je peux répondre à des questions générales de soins infirmiers ou t'aider à interpréter une tendance de constantes.",
  patient: "Bonjour ! Je peux répondre à tes questions de santé générales, t'aider avec tes rendez-vous, ou t'expliquer une ordonnance. Pour tout ce qui est sérieux, je te dirai toujours de consulter un médecin.",
};

function ChatWidget({ ctx }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState(null); // initialisé à l'ouverture, avec le message d'accueil
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  const openChat = () => {
    setOpen(true);
    if (!messages) {
      setMessages([{ role: "model", text: CHAT_GREETINGS[ctx.user.role] || "Bonjour, comment puis-je t'aider ?" }]);
    }
  };
  const closeChat = () => setOpen(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setError("");
    const nextMessages = [...messages, { role: "user", text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      // On envoie l'historique (hors message d'accueil initial) pour que
      // l'assistant garde le fil de la conversation.
      const history = nextMessages.slice(1, -1);
      const { reply } = await api.sendChatMessage(text, history);
      setMessages((prev) => [...prev, { role: "model", text: reply }]);
    } catch (err) {
      setError(err.message || "L'assistant n'a pas pu répondre.");
    } finally {
      setSending(false);
    }
  };

  const accent = ROLE_COLORS[ctx.user.role] || "bg-teal-800 text-white";

  return (
    <>
      <button
        onClick={() => (open ? closeChat() : openChat())}
        className={`fixed bottom-4 right-4 z-[150] w-14 h-14 rounded-full shadow-lg flex items-center justify-center ${accent} hover:opacity-90 active:scale-90 transition-all`}
        title="Assistant"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div
          key={expanded ? "expanded" : "normal"}
          className={`fx-chat-pop fixed bottom-20 right-4 z-[150] fx-surface border fx-border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-[width,height] duration-200 ${
            expanded
              ? "w-[36rem] h-[40rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)]"
              : "w-[22rem] h-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-8rem)]"
          }`}
        >
          <div className={`px-4 py-3 flex items-center gap-2 ${accent}`}>
            <MessageCircle size={16} />
            <span className="text-sm font-medium flex-1">Assistant · {ROLE_LABELS[ctx.user.role]}</span>
            <button type="button" onClick={() => setExpanded((v) => !v)} className="opacity-80 hover:opacity-100 p-0.5" title={expanded ? "Réduire" : "Agrandir"}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" onClick={closeChat} className="opacity-80 hover:opacity-100 p-0.5" title="Fermer">
              <X size={17} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {(messages || []).map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-teal-800 text-white" : "fx-surface-2 fx-text"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="fx-surface-2 fx-text-muted rounded-xl px-3 py-2 text-sm flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" /> L'assistant réfléchit…
                </div>
              </div>
            )}
            {error && (
              <p className="text-rose-600 dark:text-rose-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
            )}
          </div>

          <form onSubmit={send} className="border-t fx-border p-2 flex items-center gap-2">
            <input
              className={`${inputCls} flex-1`}
              placeholder="Écris ton message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()} className="bg-teal-800 text-white rounded-lg p-2.5 disabled:opacity-50 hover:bg-teal-900">
              <Send size={16} />
            </button>
          </form>
          <p className="text-[10px] fx-text-muted text-center pb-1.5">
            Réponses générées par IA — à vérifier, ne remplace pas un avis médical professionnel.
          </p>
        </div>
      )}
    </>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-24 right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border px-4 py-3 text-sm shadow-lg flex items-start gap-2 ${
            t.type === "error"
              ? "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300"
              : "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300"
          }`}
        >
          {t.type === "error" ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export default function ClinicApp() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [vitals, setVitals] = useState([]);
  const [ownDossier, setOwnDossier] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [medications, setMedications] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("fanilo_theme") === "dark");
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((type, message) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  useEffect(() => {
    localStorage.setItem("fanilo_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Charge, selon le rôle connecté, uniquement les données auxquelles
  // ce rôle a droit (le serveur applique les mêmes règles côté API ;
  // ceci évite en plus des allers-retours réseau inutiles, et pour les
  // dossiers patients, force le passage par le point d'accès audité).
  const loadDataForUser = useCallback(async (user) => {
    const medecins = await api.listUsers("medecin");
    let patients = [];
    let directory;
    if (user.role === "admin") {
      directory = await api.listUsers(); // liste complète, réservée à l'admin
    } else {
      if (["admin", "medecin", "infirmiere"].includes(user.role)) {
        patients = await api.listUsers("patient");
      }
      const map = new Map();
      [...medecins, ...patients, user].forEach((u) => map.set(u.id, u));
      directory = Array.from(map.values());
    }
    setUsers(directory);

    const appts = await api.listAppointments();
    setAppointments(appts);

    setVitals(user.role === "infirmiere" ? await api.listVitals() : []);
    setOwnDossier(user.role === "patient" ? await api.getPatientDossier(user.id) : null);

    setNotifications(await api.listNotifications().catch(() => []));
    setInvoices(user.role === "admin" || user.role === "patient" ? await api.listInvoices().catch(() => []) : []);
    setMedications(["admin", "medecin", "infirmiere"].includes(user.role) ? await api.listMedications().catch(() => []) : []);
  }, []);

  useEffect(() => {
    (async () => {
      const token = api.getStoredToken();
      if (token) {
        api.setToken(token);
        try {
          const user = await api.me();
          setCurrentUser(user);
          await loadDataForUser(user);
        } catch {
          api.setToken(null);
        }
      }
      setLoading(false);
    })();
  }, [loadDataForUser]);

  const ctx = useMemo(() => ({
    user: currentUser,
    users, appointments, vitals, ownDossier, notifications, invoices, medications,
    pushToast,

    addUser: async (u) => {
      const created = await api.createUser(u);
      setUsers((prev) => [...prev, created]);
      return created;
    },
    updateMyPhoto: async (photo) => {
      const updated = await api.updateMyPhoto(photo);
      setCurrentUser(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      return updated;
    },
    updateUser: async (id, patch) => {
      const updated = await api.updateUser(id, patch);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      return updated;
    },
    deleteUser: async (id) => {
      await api.deleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    },
    restoreUser: async (id) => {
      const restored = await api.restoreUser(id);
      setUsers((prev) => (prev.some((u) => u.id === id) ? prev : [...prev, restored]));
      return restored;
    },
    addAppointment: async (a) => {
      const created = await api.createAppointment(a);
      setAppointments((prev) => [...prev, created]);
      return created;
    },
    updateAppointment: async (id, patch) => {
      const updated = await api.updateAppointmentStatus(id, patch.statut);
      setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
      return updated;
    },
    addConsultation: async (c) => api.createConsultation(c),
    addPrescription: async (p) => {
      const created = await api.createPrescription(p);
      // La prescription peut avoir décrémenté du stock côté serveur : on
      // rafraîchit la liste locale pour que la pharmacie affichée reste juste,
      // sans attendre une reconnexion.
      if (p.medicaments.some((m) => m.medicationId)) {
        try { setMedications(await api.listMedications()); } catch { /* pas grave, non bloquant */ }
      }
      return created;
    },
    addVitals: async (v) => {
      const created = await api.createVitals(v);
      setVitals((prev) => [...prev, created]);
      return created;
    },
    getPatientDossier: (id) => api.getPatientDossier(id),

    markNotificationRead: async (id) => {
      const updated = await api.markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? updated : n)));
    },
    markAllNotificationsRead: async () => {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })));
    },

    createInvoice: async (payload) => {
      const created = await api.createInvoice(payload);
      setInvoices((prev) => [created, ...prev]);
      return created;
    },
    updateInvoice: async (id, patch) => {
      const updated = await api.updateInvoice(id, patch);
      setInvoices((prev) => prev.map((i) => (i.id === id ? updated : i)));
      return updated;
    },

    createMedication: async (payload) => {
      const created = await api.createMedication(payload);
      setMedications((prev) => [...prev, created].sort((a, b) => a.nom.localeCompare(b.nom)));
      return created;
    },
    updateMedication: async (id, patch) => {
      const updated = await api.updateMedication(id, patch);
      setMedications((prev) => prev.map((m) => (m.id === id ? updated : m)));
      return updated;
    },
    deleteMedication: async (id) => {
      await api.deleteMedication(id);
      setMedications((prev) => prev.filter((m) => m.id !== id));
    },
  }), [currentUser, users, appointments, vitals, ownDossier, notifications, invoices, medications, pushToast]);

  const handleLogin = async (email, password) => {
    const { token, user } = await api.login(email, password);
    api.setToken(token);
    setCurrentUser(user);
    await loadDataForUser(user);
    setPage("dashboard");
  };
  const handleLogout = () => {
    api.setToken(null);
    setCurrentUser(null);
    setUsers([]); setAppointments([]); setVitals([]); setOwnDossier(null);
    setNotifications([]); setInvoices([]); setMedications([]);
    setPage("dashboard");
  };

  const fontStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&family=Inter:wght@400;500;600&display=swap');
      .font-serif-display { font-family: 'Source Serif 4', Georgia, serif; }
      body, .clinic-root { font-family: 'Inter', system-ui, sans-serif; }
    `}</style>
  );

  if (loading) {
    return (
      <div className={`min-h-screen fx-page flex items-center justify-center ${darkMode ? "dark" : ""}`}>
        {fontStyle}
        <div className="flex items-center gap-2 fx-text-muted text-sm">
          <Activity size={16} className="animate-pulse" /> Chargement de la clinique…
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <div className={`clinic-root ${darkMode ? "dark" : ""}`}>{fontStyle}<LoginScreen onLogin={handleLogin} /></div>;
  }

  let content;
  let title = "";
  if (page === "dashboard") {
    content = currentUser.role === "admin" ? <AdminDashboard ctx={ctx} />
      : currentUser.role === "medecin" ? <MedecinDashboard ctx={ctx} />
      : currentUser.role === "infirmiere" ? <InfirmiereDashboard ctx={ctx} />
      : <PatientDashboard ctx={ctx} />;
  } else if (page === "users") {
    content = <UsersPage ctx={ctx} />;
  } else if (page === "appointments") {
    content = <AppointmentsPage ctx={ctx} />;
  } else if (page === "patients") {
    content = currentUser.role === "medecin" ? <MedecinPatientsPage ctx={ctx} /> : <NursePatientsPage ctx={ctx} />;
  } else if (page === "vitals") {
    content = <VitalsPage ctx={ctx} />;
  } else if (page === "availability") {
    content = <AvailabilityPage ctx={ctx} />;
  } else if (page === "book") {
    content = <BookAppointmentPage ctx={ctx} />;
  } else if (page === "record") {
    content = <PatientRecordPage ctx={ctx} />;
  } else if (page === "profile") {
    content = <ProfilePage ctx={ctx} />;
  } else if (page === "invoices") {
    content = <InvoicesPage ctx={ctx} />;
  } else if (page === "medications") {
    content = <MedicationsPage ctx={ctx} />;
  } else if (page === "audit") {
    content = <AuditLogPage ctx={ctx} />;
  }

  return (
    <div className={`clinic-root flex fx-page min-h-screen fx-text ${darkMode ? "dark" : ""}`}>
      {fontStyle}
      <Sidebar user={currentUser} page={page} setPage={setPage} onLogout={handleLogout} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((v) => !v)} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-end items-center px-6 sm:px-8 pt-5">
          <NotificationBell ctx={ctx} />
        </div>
        <div className="p-6 sm:p-8 pt-2 max-w-6xl">{content}</div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ChatWidget ctx={ctx} />
    </div>
  );
}


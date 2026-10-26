// Aufgaben und Checklisten je Gruppe, auch wiederkehrend. Abgehakt wird je Tag
// (aufgabe_haken) - so gibt es jeden Tag frische Haken und das Gestern bleibt
// nachvollziehbar. Ob eine Aufgabe an einem Tag dran ist, rechnet faelligAm().
// Was jemand sehen/anlegen/abhaken darf, entscheiden die Datenbank-Regeln.
import { $, datumZeit, db, element, knopfBeschaeftigt, meldung, zeige } from "./gemeinsam.js?v=37";

const WIEDERHOLUNG = { "": "einmalig", taeglich: "täglich", werktags: "werktags", woechentlich: "wöchentlich", monatlich: "monatlich" };
const FILTER = [["heute", "Heute"], ["meine", "Meine"], ["alle", "Alle"]];

let ich = null;
let aufgaben = [];
let haken = [];            // { aufgabe_id, tag, schritt, erledigt_von, erledigt_am }
let gruppen = [];          // { id, name, darf_schreiben }
let namen = new Map();
let gruppenNamen = new Map(); // auch Gruppen, die man nur als Admin sieht
let filter = "heute";
let offen = new Map();     // von Hand auf- (true) oder zugeklappt (false)
let bearbeitet = null;     // Aufgabe im Formular (null = neu)

// ── Wann ist eine Aufgabe dran? ─────────────────────────────────────────
export function isoTag(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const datum = (iso) => { const [j, m, t] = iso.split("-").map(Number); return new Date(j, m - 1, t); };

// Der Tag, unter dem heute abgehakt wird - oder null, wenn eine wiederkehrende Aufgabe
// heute nicht dran ist. Einmalige Aufgaben haken immer unter ihrem Faelligkeitstag
// (ohne Datum: Anlagetag) ab - das geht auch vorher. "Dran" sind sie ab diesem Tag
// und bleiben es bis zum Erledigen (dann ueberfaellig), siehe heuteDran().
export function tagFuerHeute(a, heute = isoTag(new Date())) {
  if (!a.wiederholung) return a.faellig || isoTag(new Date(a.erstellt_am));
  if (heute < a.faellig) return null;
  const h = datum(heute);
  const s = datum(a.faellig);
  const wt = h.getDay();
  if (a.wiederholung === "taeglich") return heute;
  if (a.wiederholung === "werktags") return wt >= 1 && wt <= 5 ? heute : null;
  if (a.wiederholung === "woechentlich") return wt === s.getDay() ? heute : null;
  if (a.wiederholung === "monatlich") {
    const letzter = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
    return h.getDate() === Math.min(s.getDate(), letzter) ? heute : null;
  }
  return null;
}

export function heuteDran(a, tag, heute = isoTag(new Date())) {
  return !!tag && (!!a.wiederholung || tag <= heute);
}

export function erledigt(a, tag, hakenListe) {
  const hier = hakenListe.filter((h) => h.aufgabe_id === a.id && h.tag === tag);
  if (hier.some((h) => h.schritt === -1)) return true;
  return a.schritte.length > 0 && a.schritte.every((_, i) => hier.some((h) => h.schritt === i));
}

// Fuer Startseite und Leiste: was heute (noch) dran ist.
export async function aufgabenHeute(meineId) {
  const { data: a } = await db.from("aufgaben").select("*").eq("archiviert", false);
  const liste = (a || []).map((x) => ({ ...x, tag: tagFuerHeute(x) })).filter((x) => heuteDran(x, x.tag));
  if (!liste.length) return [];
  const { data: h } = await db.from("aufgaben_haken").select("aufgabe_id, tag, schritt")
    .in("aufgabe_id", liste.map((x) => x.id)).gte("tag", liste.map((x) => x.tag).sort()[0]);
  return liste.filter((x) => !erledigt(x, x.tag, h || []))
    .sort((x, y) => (y.zustaendig_id === meineId) - (x.zustaendig_id === meineId) || (x.tag < y.tag ? -1 : 1));
}

// ── Seite ───────────────────────────────────────────────────────────────
export function aufgabenEinrichten(zurueck) {
  $("#aufgaben-zurueck").addEventListener("click", zurueck);
  $("#aufgabe-neu").addEventListener("click", () => formularZeigen(null));
  $("#aufgabe-abbrechen").addEventListener("click", () => { $("#aufgabe-form").hidden = true; });
  $("#aufgabe-form").addEventListener("submit", (e) => { e.preventDefault(); speichern(); });
  $("#aufgabe-archivieren").addEventListener("click", archivieren);
  $("#a-gruppe").addEventListener("change", zustaendigeLaden);
  $("#a-wiederholung").addEventListener("change", () => {
    $("#a-faellig-text").textContent = $("#a-wiederholung").value ? "Ab (erster Tag)" : "Fällig am (freiwillig)";
  });
}

export async function zeigeAufgaben(angemeldet) {
  ich = angemeldet;
  zeige("aufgaben");
  meldung("#aufgaben-meldung", "");
  await laden();
}

async function laden() {
  const [a, c, p, u] = await Promise.all([
    db.from("aufgaben").select("*").eq("archiviert", false).order("erstellt_am"),
    db.rpc("meine_chats"),
    db.from("profile").select("id, name").eq("aktiv", true),
    db.from("unterhaltungen").select("id, name").neq("art", "einzel"),
  ]);
  if (a.error) return meldung("#aufgaben-meldung", "Konnte nicht laden: " + a.error.message);
  aufgaben = a.data;
  gruppen = (c.data || []).filter((x) => x.art !== "einzel");
  namen = new Map((p.data || []).map((x) => [x.id, x.name]));
  gruppenNamen = new Map((u.data || []).map((x) => [x.id, x.name]));
  const heute = isoTag(new Date());
  const ab = [heute, ...aufgaben.filter((x) => !x.wiederholung).map((x) => tagFuerHeute(x))].sort()[0];
  const h = aufgaben.length
    ? await db.from("aufgaben_haken").select("*").in("aufgabe_id", aufgaben.map((x) => x.id)).gte("tag", ab)
    : { data: [] };
  haken = h.data || [];
  $("#aufgabe-neu").hidden = !gruppen.some((g) => g.darf_schreiben);
  zeichnen();
}

function zeichnen() {
  $("#aufgaben-filter").replaceChildren(...FILTER.map(([k, t]) =>
    element("button", { klasse: "chip" + (k === filter ? " an" : ""), text: t, onclick: () => { filter = k; zeichnen(); } })));
  const heute = isoTag(new Date());
  let liste = aufgaben.map((a) => ({ a, tag: tagFuerHeute(a, heute) }));
  if (filter === "heute") liste = liste.filter((x) => heuteDran(x.a, x.tag, heute) && !erledigt(x.a, x.tag, haken));
  if (filter === "meine") liste = liste.filter((x) => x.a.zustaendig_id === ich.id);
  if (filter === "alle") liste = liste.filter((x) => x.a.wiederholung || !erledigt(x.a, x.tag, haken) || x.tag >= heute);
  liste.sort((x, y) => (y.a.zustaendig_id === ich.id) - (x.a.zustaendig_id === ich.id) || ((x.tag || "9") < (y.tag || "9") ? -1 : 1));
  const leer = { heute: "Für heute ist alles erledigt 👍", meine: "Dir ist gerade nichts zugeteilt.", alle: "Noch keine Aufgaben." }[filter];
  $("#aufgaben-liste").replaceChildren(...(liste.length ? liste.map(({ a, tag }) => karte(a, tag)) : [element("p", { klasse: "leise", text: leer })]));
}

function karte(a, tag) {
  const heute = isoTag(new Date());
  const fertig = tag ? erledigt(a, tag, haken) : false;
  const hier = haken.filter((h) => h.aufgabe_id === a.id && h.tag === tag);
  const ueberfaellig = !a.wiederholung && a.faellig && a.faellig < heute && !fertig;
  const gruppe = gruppen.find((g) => g.id === a.unterhaltung_id);
  // Abhaken nur als Mitglied (Admins sehen auch fremde Gruppen, duerfen dort aber nicht haken).
  const hakbar = !!gruppe && !!tag;
  const meta = [
    gruppe?.name || gruppenNamen.get(a.unterhaltung_id),
    a.wiederholung ? `🔁 ${WIEDERHOLUNG[a.wiederholung]}` : a.faellig ? `fällig ${tagLesbar(a.faellig)}` : null,
    a.zustaendig_id ? `👤 ${namen.get(a.zustaendig_id) || "?"}` : null,
    a.wiederholung && !tag ? "heute nicht dran" : null,
  ].filter(Boolean).join(" · ");
  const fortschritt = a.schritte.length ? `${a.schritte.filter((_, i) => hier.some((h) => h.schritt === i)).length}/${a.schritte.length}` : null;
  const wer = hier.find((h) => h.schritt === -1);
  const auf = offen.get(a.id) ?? (a.schritte.length > 0 && filter === "heute" && heuteDran(a, tag, heute));

  const kopf = element("div", { klasse: "aufgabe-kopf" },
    hakbar && !a.schritte.length ? hakenBox(a, tag, -1, !!wer) : element("span", { klasse: "aufgabe-fortschritt" + (fertig ? " fertig" : ""), text: fertig ? "✓" : fortschritt || "•" }),
    element("button", { klasse: "aufgabe-titel", onclick: () => { offen.set(a.id, !auf); zeichnen(); } },
      element("strong", { text: a.titel }),
      element("span", { klasse: "leise" + (ueberfaellig ? " ueberfaellig" : ""), text: (ueberfaellig ? "⚠ überfällig · " : "") + meta }),
      wer ? element("span", { klasse: "klein", text: `✓ ${namen.get(wer.erledigt_von) || "?"} · ${datumZeit(wer.erledigt_am)}` }) : null),
    gruppe?.darf_schreiben ? element("button", { klasse: "neben klein-knopf", text: "✏️", title: "Bearbeiten", onclick: () => formularZeigen(a) }) : null);

  const inhalt = auf ? element("div", { klasse: "aufgabe-inhalt" },
    a.beschreibung ? element("p", { klasse: "langtext", text: a.beschreibung }) : null,
    a.schritte.length ? element("ul", { klasse: "aufgabe-schritte" }, ...a.schritte.map((s, i) => {
      const h = hier.find((x) => x.schritt === i);
      return element("li", {}, hakbar ? hakenBox(a, tag, i, !!h) : element("span", { text: "•" }),
        element("span", { text: s }),
        h ? element("span", { klasse: "klein", text: `${namen.get(h.erledigt_von) || "?"} · ${datumZeit(h.erledigt_am)}` }) : null);
    })) : null) : null;
  return element("article", { klasse: "aufgabe" + (fertig ? " fertig" : "") + (ueberfaellig ? " ueberfaellig" : "") }, kopf, inhalt);
}

function hakenBox(a, tag, schritt, an) {
  const box = element("input", { type: "checkbox", "aria-label": schritt === -1 ? "Erledigt" : a.schritte[schritt] });
  box.checked = an;
  // Im change-Handler steht checked schon auf dem neuen Wert.
  box.addEventListener("change", async () => {
    box.disabled = true;
    const { error } = await db.rpc("aufgabe_haken", { aufgabe: a.id, tag, schritt, an: box.checked });
    box.disabled = false;
    if (error) { box.checked = !box.checked; return meldung("#aufgaben-meldung", "Ging nicht: " + error.message); }
    const { data } = await db.from("aufgaben_haken").select("*").eq("aufgabe_id", a.id).eq("tag", tag);
    haken = [...haken.filter((h) => !(h.aufgabe_id === a.id && h.tag === tag)), ...(data || [])];
    zeichnen();
  });
  return element("label", { klasse: "aufgabe-haken" }, box);
}

// ── Formular ────────────────────────────────────────────────────────────
function formularZeigen(a) {
  bearbeitet = a;
  const schreibbar = gruppen.filter((g) => g.darf_schreiben);
  $("#aufgabe-form-titel").textContent = a ? "Aufgabe bearbeiten" : "Neue Aufgabe";
  $("#a-gruppe").replaceChildren(...schreibbar.map((g) => element("option", { value: g.id, text: g.name })));
  $("#a-gruppe").value = a?.unterhaltung_id || schreibbar[0]?.id || "";
  $("#a-gruppe").disabled = !!a; // die Gruppe einer Aufgabe bleibt fest
  $("#a-titel").value = a?.titel || "";
  $("#a-wiederholung").value = a?.wiederholung || "";
  $("#a-wiederholung").dispatchEvent(new Event("change"));
  $("#a-faellig").value = a?.faellig || "";
  $("#a-schritte").value = (a?.schritte || []).join("\n");
  $("#a-beschreibung").value = a?.beschreibung || "";
  $("#aufgabe-archivieren").hidden = !a;
  meldung("#aufgabe-meldung", "");
  $("#aufgabe-form").hidden = false;
  zustaendigeLaden().then(() => { $("#a-zustaendig").value = a?.zustaendig_id || ""; });
  $("#a-titel").focus();
}

// Zustaendig waehlbar: die Mitglieder der Gruppe - bei Gruppen "fuer alle" alle Aktiven
// (dort stehen in "mitglieder" nur die, die schreiben duerfen).
async function zustaendigeLaden() {
  const id = $("#a-gruppe").value;
  const [u, m] = await Promise.all([
    db.from("unterhaltungen").select("fuer_alle").eq("id", id).maybeSingle(),
    db.from("mitglieder").select("nutzer_id").eq("unterhaltung_id", id),
  ]);
  const ids = u.data?.fuer_alle ? [...namen.keys()] : (m.data || []).map((x) => x.nutzer_id);
  const leute = ids.filter((x) => namen.has(x)).sort((x, y) => namen.get(x).localeCompare(namen.get(y)));
  $("#a-zustaendig").replaceChildren(element("option", { value: "", text: "alle in der Gruppe" }),
    ...leute.map((id) => element("option", { value: id, text: namen.get(id) })));
}

async function speichern() {
  const titel = $("#a-titel").value.trim();
  const wiederholung = $("#a-wiederholung").value || null;
  let faellig = $("#a-faellig").value || null;
  if (!titel) return meldung("#aufgabe-meldung", "Bitte einen Titel eingeben.");
  if (wiederholung && !faellig) faellig = isoTag(new Date()); // wiederkehrend: ab heute
  const werte = {
    titel, wiederholung, faellig, zustaendig_id: $("#a-zustaendig").value || null,
    schritte: $("#a-schritte").value.split("\n").map((z) => z.trim()).filter(Boolean),
    beschreibung: $("#a-beschreibung").value.trim() || null,
  };
  const knopf = $("#aufgabe-speichern");
  knopfBeschaeftigt(knopf, true);
  const r = bearbeitet
    ? await db.from("aufgaben").update(werte).eq("id", bearbeitet.id).select("id")
    : await db.from("aufgaben").insert({ ...werte, unterhaltung_id: $("#a-gruppe").value }).select("id");
  knopfBeschaeftigt(knopf, false);
  if (r.error || !r.data?.length) return meldung("#aufgabe-meldung", "Speichern ging nicht: " + (r.error?.message || "keine Berechtigung"));
  $("#aufgabe-form").hidden = true;
  await laden();
}

async function archivieren() {
  if (!bearbeitet || !confirm(`„${bearbeitet.titel}“ archivieren? Sie verschwindet aus der Liste.`)) return;
  const { error } = await db.from("aufgaben").update({ archiviert: true }).eq("id", bearbeitet.id);
  if (error) return meldung("#aufgabe-meldung", "Ging nicht: " + error.message);
  $("#aufgabe-form").hidden = true;
  await laden();
}

const tagLesbar = (iso) => datum(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

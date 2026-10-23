// Welche Supabase-Umgebung diese Seite benutzt. Die publishable keys sind
// oeffentlich (sie stehen in jeder ausgelieferten Seite); geschuetzt wird
// alles ueber die Zugriffsregeln in der Datenbank.
const UMGEBUNGEN = {
  test: {
    url: "https://uumfckqvtxmimzvzumjx.supabase.co",
    key: "sb_publishable_eY8_m1BfmWja-LI0PoipBA_FFaakqoR",
  },
  echt: {
    url: "https://gvpqspaimrzlrmzxyaqg.supabase.co",
    key: "sb_publishable_Nnq5kIxb57j8v2grCGCFaw_LpUt5GUt",
  },
};

export const UMGEBUNG = "test";
export const SUPABASE = UMGEBUNGEN[UMGEBUNG];

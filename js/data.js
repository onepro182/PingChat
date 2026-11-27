/* ==========================================================
   PingChat - donnees fictives (mock data)
   Structure prete pour un futur branchement backend :
   remplacer CONVERSATIONS par des appels API / WebSocket.
   ========================================================== */

// Couleurs d'avatar attribuees par correspondant (sans image externe)
const AVATAR_COLORS = {
  a1: "#7c5cd6", // Sara
  a2: "#e05656", // Mehdi
  a3: "#00a884", // Groupe Dev
  a4: "#e08a2d", // Amina
  a5: "#3a8dde", // Karim
  a6: "#d6569a", // Laila
};

const CONVERSATIONS = [
  {
    id: "a1",
    name: "Sara Benali",
    status: "en ligne",
    pinned: true,
    unread: 2,
    days: [
      {
        date: "Aujourd'hui",
        messages: [
          { from: "in",  text: "Salut ! T'as vu la nouvelle version du design ?", time: "09:12" },
          { from: "out", text: "Oui, elle est propre. J'ai juste une remarque sur les couleurs.", time: "09:15", state: "read" },
          { from: "in",  text: "Dis-moi, je note.", time: "09:16" },
          { from: "out", text: "Le vert est un peu trop vif sur mobile, sinon tout est bon 👍", time: "09:18", state: "read" },
          { from: "in",  text: "OK je corrige ca cet apres-midi.", time: "09:21" },
          { from: "in",  text: "On se fait un point a 15h ?", time: "09:21" },
        ],
      },
    ],
  },
  {
    id: "a2",
    name: "Mehdi El Amrani",
    status: "vu aujourd'hui a 08:47",
    unread: 0,
    days: [
      {
        date: "Hier",
        messages: [
          { from: "in",  text: "Le match de demain soir, tu viens ?", time: "18:02" },
          { from: "out", text: "Normalement oui, je te confirme demain matin.", time: "18:10", state: "read" },
          { from: "in",  text: "Parfait, je reserve le terrain a 19h.", time: "18:12" },
        ],
      },
      {
        date: "Aujourd'hui",
        messages: [
          { from: "out", text: "C'est confirme pour ce soir ✅", time: "08:30", state: "read" },
          { from: "in",  text: "Top ! N'oublie pas tes chaussures.", time: "08:44" },
        ],
      },
    ],
  },
  {
    id: "a3",
    name: "Groupe Dev Oujda",
    status: "Sara, Karim, Youssef, +8",
    unread: 5,
    days: [
      {
        date: "Aujourd'hui",
        messages: [
          { from: "in", sender: "Karim", text: "Quelqu'un a deja migre vers la v2 de l'API ?", time: "10:05" },
          { from: "in", sender: "Youssef", text: "Oui, attention au breaking change sur l'auth.", time: "10:07" },
          { from: "out", text: "Je viens de finir la migration, je pousse la doc dans le repo.", time: "10:12", state: "delivered" },
          { from: "in", sender: "Karim", text: "Merci ! 🙏", time: "10:13" },
        ],
      },
    ],
  },
  {
    id: "a4",
    name: "Amina",
    status: "en ligne",
    unread: 1,
    days: [
      {
        date: "Aujourd'hui",
        messages: [
          { from: "out", text: "Bon anniversaire en avance ! 🎂", time: "07:55", state: "read" },
          { from: "in",  text: "Haha merci, tu es le premier a y penser 😊", time: "08:02" },
          { from: "in",  text: "On dejeune ensemble samedi ?", time: "08:03" },
        ],
      },
    ],
  },
  {
    id: "a5",
    name: "Karim Tazi",
    status: "vu hier a 22:14",
    unread: 0,
    days: [
      {
        date: "Hier",
        messages: [
          { from: "out", text: "T'as recu la facture du client ?", time: "21:40", state: "read" },
          { from: "in",  text: "Oui, je l'ai verifiee, tout est correct.", time: "21:58" },
          { from: "out", text: "Parfait, je procede au paiement demain.", time: "22:01", state: "read" },
        ],
      },
    ],
  },
  {
    id: "a6",
    name: "Laila Idrissi",
    status: "vu lundi a 14:20",
    unread: 0,
    days: [
      {
        date: "Lundi",
        messages: [
          { from: "in",  text: "Les photos du weekend sont pretes !", time: "14:15" },
          { from: "out", text: "Genial, envoie-les moi quand tu peux.", time: "14:20", state: "read" },
        ],
      },
    ],
  },
];

// Reponses automatiques simulees apres un envoi (demo locale)
const AUTO_REPLIES = [
  "OK, bien recu 👍",
  "Parfait !",
  "Je regarde ca et je te reviens.",
  "Ah bon ? Raconte.",
  "On en parle ce soir ?",
];

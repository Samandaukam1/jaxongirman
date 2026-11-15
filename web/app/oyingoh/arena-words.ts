import type { GameQuestionType } from "@jaxongirman/types";

/**
 * The words the projector sets itself once a game is chosen, in the language
 * the game's questions are written in.
 *
 * The screens before a game is chosen — the pairing code, "Telefon ulandi" —
 * stay in the site's Uzbek: there is no game yet to take a language from. From
 * the lobby on, a Russian quiz is framed in Russian: «ПРАВДА / ЛОЖЬ» beside a
 * Russian question, never «ROST / YOLG‘ON». The type names match the app's own
 * (`labels` table), so a host reading the phone and the room reading the
 * screen see the same words.
 */

export type ArenaLanguage = "uz" | "en" | "ru" | "tr";

export function arenaLanguage(value: unknown): ArenaLanguage {
  return value === "en" || value === "ru" || value === "tr" ? value : "uz";
}

type Words = {
  locale: string;
  fallbackTitle: string;
  qrAlt: string;
  code: string;
  joinHint: string;
  players: (count: number) => string;
  go: string;
  answered: (count: number, total: number) => string;
  truth: string;
  lie: string;
  answerOnPhone: string;
  /** The team grid game on the board. */
  grid: { eyebrow: string; preparing: string; turn: (team: string) => string; points: (count: number) => string; answer: string; winner: (team: string) => string; draw: string; finished: string };
  /** Mafia on the board: night and day, who is out, and every card at the end. */
  mafia: {
    eyebrow: string; night: (round: number) => string; day: (round: number) => string; nightHint: string; dayHint: string;
    alive: (count: number) => string; deck: string; next: string;
    out: { night: (round: number) => string; vote: (round: number) => string; host: string };
    roles: Record<"don" | "mafia" | "sheriff" | "doctor" | "lover" | "maniac" | "civilian", string>;
    winner: Record<"town" | "mafia" | "maniac" | "none", string>;
  };
  /** The crossword on the board: its two lists and the race beside it. */
  crossword: { across: string; down: string; race: string; done: string; solved: (solved: number, total: number) => string; solveOnPhone: string };
  answers: (count: number) => string;
  correctShare: (percent: number) => string;
  leaderboard: string;
  stopped: string;
  newGame: string;
  noWords: string;
  closed: string;
  finished: string;
  winners: string;
  /** The finish screen's heading, in two parts: plain, then the coloured word. */
  winnersTitle: readonly [string, string];
  questions: (count: number) => string;
  /** The unit after a score, "1 240 ball". */
  points: string;
  stats: { players: string; questions: string; average: string; top: string };
  types: Record<GameQuestionType, string>;
};

export type ArenaWords = Words;

export const ARENA_WORDS: Record<ArenaLanguage, Words> = {
  uz: {
    locale: "uz-UZ",
    fallbackTitle: "Öyingoh",
    qrAlt: "Öyinga qöşiliş uçun QR kod",
    code: "Kod",
    joinHint: "Telefoningiz orqali qöşiling",
    players: (count) => `${count} iştirokçi`,
    go: "BOŞLADIK!",
    answered: (count, total) => `${count} / ${total} javob`,
    truth: "ROST",
    lie: "YOLĞON",
    answerOnPhone: "Telefoningizda javob bering",
    mafia: {
      eyebrow: "MAFIA", night: (round) => `${round}-tun`, day: (round) => `${round}-kun`,
      nightHint: "Şahar uxlaydi. Hamma közini yumsin.", dayHint: "Şahar uyğondi: muhokama va ovoz beriş.",
      alive: (count) => `Öyinda: ${count}`, deck: "Kartalar", next: "Keyingi öyinga qöşiliş uçun QR kodni skaner qiling.",
      out: { night: (round) => `${round}-tunda öldi`, vote: (round) => `${round}-kunda çiqarildi`, host: "Çiqarildi" },
      roles: { don: "Don", mafia: "Mafiya", sheriff: "Komissar", doctor: "Doktor", lover: "Ma’şuqa", maniac: "Manyak", civilian: "Fuqaro" },
      winner: { town: "Tinç aholi yutdi", mafia: "Mafiya yutdi", maniac: "Manyak yutdi", none: "Öyin ğolibsiz yakunlandi" },
    },
    grid: { eyebrow: "JAMOAVIY ÖYIN", preparing: "Boşlovçi jamoalarni kiritmoqda…", turn: (team) => `Navbat: ${team}`, points: (count) => `${count} ball`, answer: "Javob", winner: (team) => `Ğolib: ${team}`, draw: "Durang", finished: "Öyin yakunlandi" },
    crossword: { across: "Gorizontal", down: "Vertikal", race: "Kim qançalik yeçdi", done: "tugatdi", solved: (solved, total) => `${solved}/${total}`, solveOnPhone: "Telefoningizda yeçing" },
    answers: (count) => `${count} javob`,
    correctShare: (percent) => `${percent}% töğri`,
    leaderboard: "Natijalar jadvali",
    stopped: "Öyin töxtatildi",
    newGame: "Yangi öyin",
    noWords: "Heç kim javob yozmadi",
    closed: "Javoblar yopildi",
    finished: "Öyin yakunlandi",
    winners: "Ğoliblar",
    winnersTitle: ["Öyin", "ğoliblari"],
    questions: (count) => `${count} ta savol`,
    points: "ball",
    stats: { players: "Öyinçilar", questions: "Savollar", average: "Örtaça ball", top: "Eng yuqori" },
    // The app's own names (`labels`), in the updated alphabet as the app shows them.
    types: {
      single_choice: "Boş qotirma", true_false: "Rostmi, yolğonmi?", multiple_choice: "Bir neçtasini tanlang",
      ordering: "Tartibga soling", matching: "Juftini toping", fill_blank: "Böş joyni töldiring",
      word_cloud: "Sözlar buluti", poll: "Ovoz beriş", open_answer: "Erkin javob", image_quiz: "Rasmni toping",
      hotspot: "Rasmdan joyni toping",
      crossword: "Krossvord",
    },
  },
  en: {
    locale: "en-US",
    fallbackTitle: "O‘yingoh",
    qrAlt: "QR code to join the game",
    code: "Code",
    joinHint: "Join from your phone",
    players: (count) => `${count} ${count === 1 ? "player" : "players"}`,
    go: "LET’S GO!",
    answered: (count, total) => `${count} / ${total} answered`,
    truth: "TRUE",
    lie: "FALSE",
    answerOnPhone: "Answer on your phone",
    mafia: {
      eyebrow: "MAFIA", night: (round) => `Night ${round}`, day: (round) => `Day ${round}`,
      nightHint: "The city sleeps. Everyone, close your eyes.", dayHint: "The city wakes up: discuss and vote.",
      alive: (count) => `In the game: ${count}`, deck: "The cards", next: "Scan the QR code to join the next game.",
      out: { night: (round) => `Died on night ${round}`, vote: (round) => `Voted out on day ${round}`, host: "Removed" },
      roles: { don: "Don", mafia: "Mafia", sheriff: "Detective", doctor: "Doctor", lover: "Lover", maniac: "Maniac", civilian: "Civilian" },
      winner: { town: "The town wins", mafia: "The mafia win", maniac: "The maniac wins", none: "The game ended without a winner" },
    },
    grid: { eyebrow: "TEAM GAME", preparing: "The host is setting up the teams…", turn: (team) => `Turn: ${team}`, points: (count) => `${count} points`, answer: "Answer", winner: (team) => `Winner: ${team}`, draw: "A draw", finished: "The game is over" },
    crossword: { across: "Across", down: "Down", race: "The race", done: "done", solved: (solved, total) => `${solved}/${total}`, solveOnPhone: "Solve it on your phone" },
    answers: (count) => `${count} ${count === 1 ? "answer" : "answers"}`,
    correctShare: (percent) => `${percent}% correct`,
    leaderboard: "Leaderboard",
    stopped: "The game was stopped",
    newGame: "New game",
    noWords: "Nobody wrote an answer",
    closed: "Answers are closed",
    finished: "Game over",
    winners: "Winners",
    winnersTitle: ["The", "winners"],
    questions: (count) => `${count} ${count === 1 ? "question" : "questions"}`,
    points: "pts",
    stats: { players: "Players", questions: "Questions", average: "Average score", top: "Top score" },
    types: {
      single_choice: "Brain teaser", true_false: "True or false?", multiple_choice: "Choose several",
      ordering: "Put in order", matching: "Find the pair", fill_blank: "Fill in the blank",
      word_cloud: "Word cloud", poll: "Poll", open_answer: "Open answer", image_quiz: "Guess the picture",
      hotspot: "Find the spot",
      crossword: "Crossword",
    },
  },
  ru: {
    locale: "ru-RU",
    fallbackTitle: "O‘yingoh",
    qrAlt: "QR-код, чтобы присоединиться к игре",
    code: "Код",
    joinHint: "Присоединяйтесь с телефона",
    // Number-agnostic, as in the app: «Участников: 5» reads right for any count.
    players: (count) => `Участников: ${count}`,
    go: "НАЧАЛИ!",
    answered: (count, total) => `Ответили: ${count} / ${total}`,
    truth: "ПРАВДА",
    lie: "ЛОЖЬ",
    answerOnPhone: "Отвечайте на телефоне",
    mafia: {
      eyebrow: "МАФИЯ", night: (round) => `Ночь ${round}`, day: (round) => `День ${round}`,
      nightHint: "Город засыпает. Все закрывают глаза.", dayHint: "Город просыпается: обсуждение и голосование.",
      alive: (count) => `В игре: ${count}`, deck: "Карты", next: "Отсканируйте QR-код, чтобы войти в следующую игру.",
      out: { night: (round) => `Убит в ночь ${round}`, vote: (round) => `Выбыл в день ${round}`, host: "Удалён" },
      roles: { don: "Дон", mafia: "Мафия", sheriff: "Комиссар", doctor: "Доктор", lover: "Любовница", maniac: "Маньяк", civilian: "Мирный житель" },
      winner: { town: "Победили мирные", mafia: "Победила мафия", maniac: "Победил маньяк", none: "Игра завершена без победителя" },
    },
    grid: { eyebrow: "КОМАНДНАЯ ИГРА", preparing: "Ведущий вводит команды…", turn: (team) => `Ход: ${team}`, points: (count) => `${count} очков`, answer: "Ответ", winner: (team) => `Победитель: ${team}`, draw: "Ничья", finished: "Игра окончена" },
    crossword: { across: "По горизонтали", down: "По вертикали", race: "Кто сколько решил", done: "сдал", solved: (solved, total) => `${solved}/${total}`, solveOnPhone: "Решайте на телефоне" },
    answers: (count) => `Ответов: ${count}`,
    correctShare: (percent) => `${percent}% верно`,
    leaderboard: "Таблица результатов",
    stopped: "Игра остановлена",
    newGame: "Новая игра",
    noWords: "Никто не написал ответ",
    closed: "Ответы закрыты",
    finished: "Игра окончена",
    winners: "Победители",
    winnersTitle: ["Победители", "игры"],
    questions: (count) => `Вопросов: ${count}`,
    points: "очк.",
    stats: { players: "Игроков", questions: "Вопросов", average: "Средний балл", top: "Лучший результат" },
    types: {
      single_choice: "Головоломка", true_false: "Правда или ложь?", multiple_choice: "Выберите несколько",
      ordering: "Расставьте по порядку", matching: "Найдите пару", fill_blank: "Заполните пропуск",
      word_cloud: "Облако слов", poll: "Голосование", open_answer: "Свободный ответ", image_quiz: "Угадайте картинку",
      hotspot: "Найдите место на картинке",
      crossword: "Кроссворд",
    },
  },
  tr: {
    locale: "tr-TR",
    fallbackTitle: "Öyingoh",
    qrAlt: "Oyuna katılmak için QR kod",
    code: "Kod",
    joinHint: "Telefonunuzdan katılın",
    players: (count) => `${count} oyuncu`,
    go: "BAŞLIYORUZ!",
    answered: (count, total) => `${count} / ${total} cevapladı`,
    truth: "DOĞRU",
    lie: "YANLIŞ",
    answerOnPhone: "Telefonunuzdan cevaplayın",
    mafia: {
      eyebrow: "MAFYA", night: (round) => `${round}. gece`, day: (round) => `${round}. gündüz`,
      nightHint: "Şehir uyuyor. Herkes gözlerini kapatsın.", dayHint: "Şehir uyandı: tartışma ve oylama.",
      alive: (count) => `Oyunda: ${count}`, deck: "Kartlar", next: "Sonraki oyuna katılmak için QR kodu okutun.",
      out: { night: (round) => `${round}. gece öldü`, vote: (round) => `${round}. gündüz çıkarıldı`, host: "Çıkarıldı" },
      roles: { don: "Don", mafia: "Mafya", sheriff: "Komiser", doctor: "Doktor", lover: "Sevgili", maniac: "Manyak", civilian: "Köylü" },
      winner: { town: "Köylüler kazandı", mafia: "Mafya kazandı", maniac: "Manyak kazandı", none: "Oyun kazanansız bitti" },
    },
    grid: { eyebrow: "TAKIM OYUNU", preparing: "Sunucu takımları giriyor…", turn: (team) => `Sıra: ${team}`, points: (count) => `${count} puan`, answer: "Cevap", winner: (team) => `Kazanan: ${team}`, draw: "Berabere", finished: "Oyun bitti" },
    crossword: { across: "Soldan sağa", down: "Yukarıdan aşağıya", race: "Kim ne kadar çözdü", done: "bitirdi", solved: (solved, total) => `${solved}/${total}`, solveOnPhone: "Telefonunuzdan çözün" },
    answers: (count) => `${count} cevap`,
    correctShare: (percent) => `%${percent} doğru`,
    leaderboard: "Sıralama",
    stopped: "Oyun durduruldu",
    newGame: "Yeni oyun",
    noWords: "Kimse cevap yazmadı",
    closed: "Cevaplar kapandı",
    finished: "Oyun bitti",
    winners: "Kazananlar",
    winnersTitle: ["Oyunun", "kazananları"],
    questions: (count) => `${count} soru`,
    points: "puan",
    stats: { players: "Oyuncular", questions: "Sorular", average: "Ortalama puan", top: "En yüksek puan" },
    types: {
      single_choice: "Bilgi yarışması", true_false: "Doğru mu, yanlış mı?", multiple_choice: "Birden fazla seçin",
      ordering: "Sıraya koyun", matching: "Eşini bulun", fill_blank: "Boşluğu doldurun",
      word_cloud: "Kelime bulutu", poll: "Anket", open_answer: "Açık cevap", image_quiz: "Resmi tahmin edin",
      hotspot: "Noktayı bulun",
      crossword: "Bulmaca",
    },
  },
};

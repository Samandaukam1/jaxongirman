import { GAME_TYPE_LABELS, type GameQuestionType } from "@jaxongirman/types";

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

export type ArenaLanguage = "uz" | "en" | "ru";

export function arenaLanguage(value: unknown): ArenaLanguage {
  return value === "en" || value === "ru" ? value : "uz";
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
  answers: (count: number) => string;
  correctShare: (percent: number) => string;
  leaderboard: string;
  stopped: string;
  newGame: string;
  noWords: string;
  closed: string;
  finished: string;
  winners: string;
  types: Record<GameQuestionType, string>;
};

export const ARENA_WORDS: Record<ArenaLanguage, Words> = {
  uz: {
    locale: "uz-UZ",
    fallbackTitle: "O‘yingoh",
    qrAlt: "O‘yinga qo‘shilish uchun QR kod",
    code: "Kod",
    joinHint: "Telefoningiz orqali qo‘shiling",
    players: (count) => `${count} ishtirokchi`,
    go: "BOSHLADIK!",
    answered: (count, total) => `${count} / ${total} javob`,
    truth: "ROST",
    lie: "YOLG‘ON",
    answerOnPhone: "Telefoningizda javob bering",
    answers: (count) => `${count} javob`,
    correctShare: (percent) => `${percent}% to‘g‘ri`,
    leaderboard: "Natijalar jadvali",
    stopped: "O‘yin to‘xtatildi",
    newGame: "Yangi o‘yin",
    noWords: "Hech kim javob yozmadi",
    closed: "Javoblar yopildi",
    finished: "O‘yin yakunlandi",
    winners: "G‘oliblar",
    types: GAME_TYPE_LABELS,
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
    answers: (count) => `${count} ${count === 1 ? "answer" : "answers"}`,
    correctShare: (percent) => `${percent}% correct`,
    leaderboard: "Leaderboard",
    stopped: "The game was stopped",
    newGame: "New game",
    noWords: "Nobody wrote an answer",
    closed: "Answers are closed",
    finished: "Game over",
    winners: "Winners",
    types: {
      single_choice: "Brain teaser", true_false: "True or false?", multiple_choice: "Choose several",
      ordering: "Put in order", matching: "Find the pair", fill_blank: "Fill in the blank",
      word_cloud: "Word cloud", poll: "Poll", open_answer: "Open answer", image_quiz: "Guess the picture",
      hotspot: "Find the spot",
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
    answers: (count) => `Ответов: ${count}`,
    correctShare: (percent) => `${percent}% верно`,
    leaderboard: "Таблица результатов",
    stopped: "Игра остановлена",
    newGame: "Новая игра",
    noWords: "Никто не написал ответ",
    closed: "Ответы закрыты",
    finished: "Игра окончена",
    winners: "Победители",
    types: {
      single_choice: "Головоломка", true_false: "Правда или ложь?", multiple_choice: "Выберите несколько",
      ordering: "Расставьте по порядку", matching: "Найдите пару", fill_blank: "Заполните пропуск",
      word_cloud: "Облако слов", poll: "Голосование", open_answer: "Свободный ответ", image_quiz: "Угадайте картинку",
      hotspot: "Найдите место на картинке",
    },
  },
};

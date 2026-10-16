import { translations } from "../define";

/**
 * Names of the server's codes — statuses, kinds, sort orders — keyed exactly as
 * the shared tables in `@jaxongirman/types` are, which stay Uzbek for the console.
 */
export default translations(
  {
    gameStatus: { generating: "Yaratilmoqda", draft: "Qoralama", ready: "Tayyor", archived: "Arxivda", failed: "Xatolik" },
    gameDifficulty: { oson: "Oson", ortacha: "O‘rtacha", qiyin: "Qiyin", aralash: "Aralash" },
    gameType: {
      single_choice: "Bosh qotirma", true_false: "Rostmi, yolg‘onmi?", multiple_choice: "Bir nechtasini tanlang",
      ordering: "Tartibga soling", matching: "Juftini toping", fill_blank: "Bo‘sh joyni to‘ldiring",
      word_cloud: "So‘zlar buluti", poll: "Ovoz berish", open_answer: "Erkin javob", image_quiz: "Rasmni toping",
      hotspot: "Rasmdan joyni toping",
    },
    surveyQuestion: {
      short_text: "Qisqa matn", long_text: "Uzun matn", phone: "Telefon raqam", image: "Rasm yuklash",
      single_choice: "Bitta variant", multi_choice: "Bir nechta variant", date: "Sana", number: "Raqam",
    },
    surveyStatus: { draft: "Qoralama", open: "Faol", closed: "Tugagan" },
    productStatus: {
      draft: "Qoralama", pending_review: "Tekshiruvda", approved: "Sotuvda", rejected: "Qaytarilgan",
      hidden: "Yashirilgan", archived: "Arxivlangan",
    },
    audience: {
      maktab_1_4: "1–4-sinf", maktab_5_9: "5–9-sinf", maktab_10_11: "10–11-sinf", maktab: "Maktab",
      universitet_bakalavr: "Bakalavriat", universitet_magistr: "Magistratura", universitet: "Universitet", umumiy: "Umumiy",
    },
    sort: { newest: "Yangi", popular: "Ommabop", rating: "Yuqori baho", price_asc: "Arzon", price_desc: "Qimmat" },
  },
  {
    gameStatus: { generating: "Generating", draft: "Draft", ready: "Ready", archived: "Archived", failed: "Error" },
    gameDifficulty: { oson: "Easy", ortacha: "Medium", qiyin: "Hard", aralash: "Mixed" },
    gameType: {
      single_choice: "Brain teaser", true_false: "True or false?", multiple_choice: "Choose several",
      ordering: "Put in order", matching: "Find the pair", fill_blank: "Fill in the blank",
      word_cloud: "Word cloud", poll: "Poll", open_answer: "Open answer", image_quiz: "Guess the picture",
      hotspot: "Find the spot",
    },
    surveyQuestion: {
      short_text: "Short text", long_text: "Long text", phone: "Phone number", image: "Image upload",
      single_choice: "Single choice", multi_choice: "Multiple choice", date: "Date", number: "Number",
    },
    surveyStatus: { draft: "Draft", open: "Active", closed: "Ended" },
    productStatus: {
      draft: "Draft", pending_review: "In review", approved: "On sale", rejected: "Returned",
      hidden: "Hidden", archived: "Archived",
    },
    audience: {
      maktab_1_4: "Grades 1–4", maktab_5_9: "Grades 5–9", maktab_10_11: "Grades 10–11", maktab: "School",
      universitet_bakalavr: "Bachelor's", universitet_magistr: "Master's", universitet: "University", umumiy: "General",
    },
    sort: { newest: "Newest", popular: "Popular", rating: "Top rated", price_asc: "Cheapest", price_desc: "Most expensive" },
  },
  {
    gameStatus: { generating: "Создаётся", draft: "Черновик", ready: "Готово", archived: "В архиве", failed: "Ошибка" },
    gameDifficulty: { oson: "Легко", ortacha: "Средне", qiyin: "Сложно", aralash: "Смешанно" },
    gameType: {
      single_choice: "Головоломка", true_false: "Правда или ложь?", multiple_choice: "Выберите несколько",
      ordering: "Расставьте по порядку", matching: "Найдите пару", fill_blank: "Заполните пропуск",
      word_cloud: "Облако слов", poll: "Голосование", open_answer: "Свободный ответ", image_quiz: "Угадайте картинку",
      hotspot: "Найдите место на картинке",
    },
    surveyQuestion: {
      short_text: "Короткий текст", long_text: "Длинный текст", phone: "Номер телефона", image: "Загрузка изображения",
      single_choice: "Один вариант", multi_choice: "Несколько вариантов", date: "Дата", number: "Число",
    },
    surveyStatus: { draft: "Черновик", open: "Активен", closed: "Завершён" },
    productStatus: {
      draft: "Черновик", pending_review: "На проверке", approved: "В продаже", rejected: "Возвращён",
      hidden: "Скрыт", archived: "В архиве",
    },
    audience: {
      maktab_1_4: "1–4 классы", maktab_5_9: "5–9 классы", maktab_10_11: "10–11 классы", maktab: "Школа",
      universitet_bakalavr: "Бакалавриат", universitet_magistr: "Магистратура", universitet: "Университет", umumiy: "Общая",
    },
    sort: { newest: "Новые", popular: "Популярные", rating: "С высоким рейтингом", price_asc: "Дешевле", price_desc: "Дороже" },
  },
);

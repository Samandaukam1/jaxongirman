import { translations } from "../define";

/** Shared pieces: the route error, state blocks, the celebration, account deletion and uploads. */
export default translations(
  {
    routeError: {
      title: "Nimadir noto‘g‘ri ketdi",
      body: "Bu sahifani ochishda kutilmagan xatolik yuz berdi. Ma’lumotlaringiz joyida — qayta urinib ko‘ring.",
    },
    loadFailed: "Ma’lumot yuklanmadi",
    emailConfirming: "Email tasdiqlanmoqda…",
    surveyOwner: "Siz yaratgansiz",
    answered: "Javob berilgan",
    celebrate: { title: "Tabriklaymiz!", amount: "+{{amount}} tanga", ok: "Ajoyib" },
    headerBack: "Orqaga",
    deleteAccount: {
      title: "Hisobingizni butunlay o‘chirmoqchimisiz?",
      body: "Bu amal natijasida akkauntingiz va unga tegishli o‘chirilishi kerak bo‘lgan shaxsiy ma’lumotlar o‘chiriladi. Bu amalni ortga qaytarib bo‘lmaydi.",
      cancel: "BEKOR QILISH",
      confirm: "O‘CHIRISH",
      label: "Hisobni o‘chirish",
      failed: "Hisobni o‘chirib bo‘lmadi",
    },
    upload: { unreadable: "Fayl o‘qilmadi. Boshqa fayl tanlang.", tooLarge: "Fayl juda katta." },
  },
  {
    routeError: {
      title: "Something went wrong",
      body: "An unexpected error occurred while opening this page. Your data is safe — please try again.",
    },
    loadFailed: "Couldn't load the data",
    emailConfirming: "Confirming your email…",
    surveyOwner: "Created by you",
    answered: "Answered",
    celebrate: { title: "Congratulations!", amount: "+{{amount}} coins", ok: "Great" },
    headerBack: "Back",
    deleteAccount: {
      title: "Delete your account for good?",
      body: "This deletes your account and the personal data tied to it that must be removed. It can't be undone.",
      cancel: "CANCEL",
      confirm: "DELETE",
      label: "Delete account",
      failed: "Couldn't delete the account",
    },
    upload: { unreadable: "The file couldn't be read. Choose another one.", tooLarge: "The file is too large." },
  },
  {
    routeError: {
      title: "Что-то пошло не так",
      body: "При открытии страницы произошла непредвиденная ошибка. Ваши данные на месте — попробуйте ещё раз.",
    },
    loadFailed: "Данные не загрузились",
    emailConfirming: "Подтверждаем email…",
    surveyOwner: "Создан вами",
    answered: "Ответ дан",
    celebrate: { title: "Поздравляем!", amount: "+{{amount}} монет", ok: "Отлично" },
    headerBack: "Назад",
    deleteAccount: {
      title: "Удалить аккаунт навсегда?",
      body: "Будут удалены ваш аккаунт и связанные с ним персональные данные, подлежащие удалению. Это действие нельзя отменить.",
      cancel: "ОТМЕНА",
      confirm: "УДАЛИТЬ",
      label: "Удалить аккаунт",
      failed: "Не удалось удалить аккаунт",
    },
    upload: { unreadable: "Не удалось прочитать файл. Выберите другой.", tooLarge: "Файл слишком большой." },
  },
);

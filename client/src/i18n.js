import { useEffect } from "react";

// English fonts per the Tanami brand guide: Merriweather (titles), Merriweather Sans
// (subtitles/eyebrow labels), Manrope (body). Arabic uses the brand guide's own,
// separate Arabic pairing: Noto Kufi Arabic (headings) and Rubik (body + labels) — see
// the "Typography / Arabic" page of the brand book. Question content (prompts/options)
// stays English until the translated question bank arrives, regardless of `lang`.
export const FONTS = {
  en: {
    serif: "'Merriweather',Georgia,serif",
    sansBold: "'Merriweather Sans',sans-serif",
    body: "'Manrope', system-ui, sans-serif",
  },
  ar: {
    serif: "'Noto Kufi Arabic', sans-serif",
    sansBold: "'Rubik', sans-serif",
    body: "'Rubik', sans-serif",
  },
};

export const ROUND_LABELS = {
  en: { R1: "Public or Private", R2: "Valuation Showdown", R3: "This or That" },
  ar: { R1: "عامة أم خاصة", R2: "تحدي التقييم", R3: "هذا أم ذاك" },
};

// Easy/Medium/Hard are metadata about the question (like its point value), not the
// question text itself, so unlike prompts/options these translate now rather than
// waiting on the marketing question bank.
const DIFFICULTY_LABELS = {
  en: { Easy: "EASY", Medium: "MEDIUM", Hard: "HARD" },
  ar: { Easy: "سهل", Medium: "متوسط", Hard: "صعب" },
};

export function translateDifficulty(difficulty, lang) {
  return DIFFICULTY_LABELS[lang]?.[difficulty] ?? difficulty?.toUpperCase() ?? "";
}

// Arabic numeral-noun agreement (1 singular, 2 dual, 3-10 plural, 0/11+ singular-with-
// digit) — the pattern real Arabic apps use, not classical case-precise duals, which
// read as stiff/over-formal in casual UI copy. `two` is given in the oblique ("ين")
// form since that's what modern app Arabic uses even in subject position.
function arabicCountedNoun(n, { one, two, few, many }) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n === 0 || (n >= 3 && n <= 10)) return `${n} ${few}`;
  return `${n} ${many}`;
}

const AR_QUESTION_NOUN = { one: "سؤال واحد", two: "سؤالين", few: "أسئلة", many: "سؤالاً" };
const AR_ANSWER_NOUN = { one: "إجابة واحدة", two: "إجابتين", few: "إجابات", many: "إجابة" };

const STRINGS = {
  en: {
    // Language picker — shown only to the first player to join.
    chooseLanguage: "Choose your language",
    chooseLanguageSubtitle: "This sets the language for both players.",
    english: "English",
    arabicLabel: "العربية",
    continue: "Continue",

    // Lobby / name entry
    heroLine1: "Two players.",
    heroLine2: "Three rounds.",
    heroLine3: "One minute each.",
    yourNameLabel: "YOUR NAME",
    namePlaceholder: "Type your name",
    readyWaitingFor: (name) => `Ready. Waiting for ${name}`,
    imReady: "I'm ready",
    otherIsReady: (name) => `${name} is ready`,
    addNamePrompt: "Add your name, then press ready",
    seatOf2: (n) => `Seat ${n} of 2`,

    // Countdown
    roundOf3: (n) => `ROUND ${n} OF 3`,
    getThumbsReady: "Get your thumbs ready",

    // Playing
    roundCleared: "ROUND CLEARED",
    waitingForClock: "Waiting for the clock",
    correct: "CORRECT",
    notThisTime: "NOT THIS TIME",
    runnerUpNote: (name, gain, points) => `${name} answered first, so you get ${gain} instead of ${points}`,
    timesUp: "Time's up",
    difficultyPoints: (difficulty, points) => `${difficulty} · ${points} PTS`,
    otherAnswered: (name) => `${name} has answered. Your turn.`,
    waitingForOther: (name) => `Waiting for ${name}…`,
    vs: "VS",

    // Finished — player view
    finalThreeRounds: "FINAL · 3 ROUNDS",
    youWon: "You won",
    youLost: "You lost",
    deadHeat: "Dead heat",
    tiedFaster: "Tied on points — you answered faster.",
    tiedOtherFaster: (name) => `Tied on points — ${name} answered faster.`,
    you: "YOU",
    goodRun: "Good run.",
    soClose: "So close.",
    answeredInTime: (count, dur) => `You answered ${count} questions in ${dur}.`,
    emailToEnter: "EMAIL TO ENTER THE LEADERBOARD",
    thanksInTouch: "Thanks — we'll be in touch.",
    emailPlaceholder: "name@company.com",
    submit: "Submit",
    sending: "Sending…",
    emailError: "Couldn't submit that — check the email and try again.",
    prizeNote: "Top 5 on the leaderboard get $200 credited on their first investment.",

    connecting: "Connecting…",
    cantJoin: "Can't join this match",
    playerPlaceholder: (slot) => `Player ${slot}`,
    bothPlaceholder: "Both",

    // Join failures — keyed by the server's stable errorCode (see gameEngine#addPlayer),
    // not by the raw English `error` string it also sends (that one's for server
    // logs/API debugging only, never shown to a player).
    errorQrExpired: "This QR code has expired — scan the current one on the booth screen.",
    errorMatchInProgress: "This match has already started.",
    errorMatchFull: "This match is full.",
    errorUnableToJoin: "Unable to join this match.",

    // Booth screen (ScreenPage)
    heroTitleLine1: "How well do you",
    heroTitleLine2: "really know money?",
    idleSubtitle: "Two players, three 60-second rounds. Scan, add your name, press ready.",
    scanToJoin: "Scan to join",
    starting: "Starting…",
    playersStillReady: (n) => `${n} player(s) still to press ready`,
    leaderboard: "Leaderboard",
    top5: "TOP 5",
    noGamesYet: "No games played yet — be the first!",
    topScore: "TOP SCORE",
    leaderboardEmails: "Leaderboard emails",
    noEntriesYet: "No entries yet.",
    colHash: "#",
    colName: "Name",
    colScore: "Score",
    colEmail: "Email",
    close: "Close",
    eventName: "Money20/20",
    vsBetween: (a, b) => `${a} vs ${b}`,
    leading: "LEADING",
    answeredCount: (n) => `${n} answered`,
    lockedIn: "Locked in",
    choosing: "Choosing…",
    playersPicked: (n) => `${n} of 2 players picked`,
    nextQuestionLoading: "Next question loading",
    gameOverThreeRounds: "GAME OVER · 3 ROUNDS",
    takesIt: (name) => `${name} takes it`,
    winner: "WINNER",
    runnerUp: "RUNNER-UP",
    answersInDuration: (count, dur) => `${count} answers in ${dur}`,
    goToLeaderboard: "Go to leaderboard",
    confirmNextMatch: "Go to the leaderboard and open the booth for the next pair?",
  },
  ar: {
    chooseLanguage: "اختر لغتك",
    chooseLanguageSubtitle: "ستُستخدم هذه اللغة لكلا اللاعبين.",
    english: "English",
    arabicLabel: "العربية",
    continue: "متابعة",

    heroLine1: "لاعبان.",
    heroLine2: "ثلاث جولات.",
    heroLine3: "دقيقة واحدة لكل جولة.",
    yourNameLabel: "اسمك",
    namePlaceholder: "اكتب اسمك",
    readyWaitingFor: (name) => `جاهز. بانتظار ${name}`,
    imReady: "أنا جاهز",
    otherIsReady: (name) => `${name} جاهز`,
    addNamePrompt: "أضف اسمك، ثم اضغط جاهز",
    seatOf2: (n) => `المقعد ${n} من أصل 2`,

    roundOf3: (n) => `الجولة ${n} من أصل 3`,
    getThumbsReady: "استعدّ للإجابة!",

    roundCleared: "انتهت الجولة",
    waitingForClock: "بانتظار انتهاء الجولة",
    correct: "إجابة صحيحة",
    notThisTime: "ليست هذه المرة",
    runnerUpNote: (name, gain, points) => `${name} أجاب أولاً، لذا حصلت على ${gain} بدلاً من ${points}`,
    timesUp: "انتهى الوقت",
    difficultyPoints: (difficulty, points) => `${difficulty} · ${points} نقطة`,
    otherAnswered: (name) => `${name} أجاب. حان دورك.`,
    waitingForOther: (name) => `بانتظار ${name}…`,
    vs: "ضد",

    finalThreeRounds: "النتيجة النهائية · 3 جولات",
    youWon: "لقد فزت",
    youLost: "لقد خسرت",
    deadHeat: "تعادل",
    tiedFaster: "تعادل بالنقاط — أنت أجبت أسرع.",
    tiedOtherFaster: (name) => `تعادل بالنقاط — ${name} أجاب أسرع.`,
    you: "أنت",
    goodRun: "أداء جيد.",
    soClose: "كانت النتيجة قريبة جدًا.",
    answeredInTime: (count, dur) => `أجبت على ${arabicCountedNoun(count, AR_QUESTION_NOUN)} في ${dur}.`,
    emailToEnter: "أدخل بريدك الإلكتروني للدخول في لوحة المتصدرين",
    thanksInTouch: "شكرًا لك — سنتواصل معك قريبًا.",
    emailPlaceholder: "name@company.com",
    submit: "إرسال",
    sending: "جارٍ الإرسال…",
    emailError: "تعذر الإرسال — تحقق من البريد الإلكتروني وحاول مرة أخرى.",
    prizeNote: "أفضل 5 لاعبين في لوحة المتصدرين يحصلون على 200 دولار تُضاف إلى استثمارهم الأول.",

    connecting: "جارٍ الاتصال…",
    cantJoin: "لا يمكن الانضمام إلى هذه المباراة",
    playerPlaceholder: (slot) => (slot === 1 ? "اللاعب الأول" : "اللاعب الثاني"),
    bothPlaceholder: "كلاهما",

    errorQrExpired: "انتهت صلاحية رمز QR هذا — امسح الرمز الحالي على شاشة الجناح.",
    errorMatchInProgress: "هذه المباراة قد بدأت بالفعل.",
    errorMatchFull: "هذه المباراة مكتملة.",
    errorUnableToJoin: "تعذر الانضمام إلى هذه المباراة.",

    heroTitleLine1: "إلى أي مدى تعرف",
    heroTitleLine2: "عالم المال؟",
    idleSubtitle: "لاعبان، ثلاث جولات مدة كل منها 60 ثانية. امسح الرمز، أضف اسمك، واضغط جاهز.",
    scanToJoin: "امسح للانضمام",
    starting: "جارٍ البدء…",
    playersStillReady: (n) => (n <= 1 ? "لاعب واحد لم يضغط جاهز بعد" : "لاعبين لم يضغطوا جاهز بعد"),
    leaderboard: "لوحة المتصدرين",
    top5: "أفضل 5",
    noGamesYet: "لم تُلعب أي مباراة بعد — كن الأول!",
    topScore: "أعلى نتيجة",
    leaderboardEmails: "البريد الإلكتروني للمتصدرين",
    noEntriesYet: "لا توجد إدخالات بعد.",
    colHash: "#",
    colName: "الاسم",
    colScore: "النتيجة",
    colEmail: "البريد الإلكتروني",
    close: "إغلاق",
    eventName: "Money20/20",
    vsBetween: (a, b) => `${a} ضد ${b}`,
    leading: "متقدم",
    answeredCount: (n) => `أجاب على ${arabicCountedNoun(n, AR_QUESTION_NOUN)}`,
    lockedIn: "أجاب",
    choosing: "يختار…",
    playersPicked: (n) => `اختاره ${n} من 2`,
    nextQuestionLoading: "جارٍ تحميل السؤال التالي…",
    gameOverThreeRounds: "انتهت اللعبة · 3 جولات",
    takesIt: (name) => `${name} يفوز!`,
    winner: "الفائز",
    runnerUp: "الوصيف",
    answersInDuration: (count, dur) => `${arabicCountedNoun(count, AR_ANSWER_NOUN)} في ${dur}`,
    goToLeaderboard: "الانتقال إلى لوحة المتصدرين",
    confirmNextMatch: "الانتقال إلى لوحة المتصدرين وفتح الجناح للزوج التالي؟",
  },
};

// t("key") for a plain string, t("key", arg1, arg2) for one of the function entries above.
export function makeTranslator(lang) {
  return function t(key, ...args) {
    const entry = STRINGS[lang]?.[key] ?? STRINGS.en[key];
    return typeof entry === "function" ? entry(...args) : entry;
  };
}

const JOIN_ERROR_KEYS = {
  qr_expired: "errorQrExpired",
  match_in_progress: "errorMatchInProgress",
  match_full: "errorMatchFull",
};

// `code` is the server's errorCode (see gameEngine#addPlayer) — an unrecognized or
// missing code (e.g. a network failure with no server response at all) falls back to
// a generic translated message rather than ever showing raw English server text.
export function translateJoinError(code, lang) {
  return makeTranslator(lang)(JOIN_ERROR_KEYS[code] ?? "errorUnableToJoin");
}

// "3m 20s" / "45s" in English; "٣د ٢٠ث"-style unit letters aren't used here deliberately —
// Gulf fintech UIs (Tanami included, per the brand samples) keep Western numerals even in
// Arabic copy, so only the unit words change.
export function formatDuration(ms, lang) {
  const t = Math.round(ms / 1000);
  const unit = lang === "ar" ? { m: "د ", s: "ث" } : { m: "m ", s: "s" };
  return t >= 60 ? `${Math.floor(t / 60)}${unit.m}${t % 60}${unit.s}` : `${t}${unit.s}`;
}

// Normalizes whatever the server sent (or "en" before a match/language exists yet) into
// a supported language, and keeps <html lang/dir> in sync so native RTL behavior (text
// selection, scrollbars, input caret direction) works everywhere, not just our own CSS.
export function useLanguage(rawLanguage) {
  const lang = rawLanguage === "ar" ? "ar" : "en";
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  return { lang, dir, t: makeTranslator(lang), fonts: FONTS[lang], roundLabels: ROUND_LABELS[lang] };
}

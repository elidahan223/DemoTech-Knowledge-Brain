# מבנה הקוד

החלוקה מבוססת על המבנה של **Danya.Client** ושל **Danya.Server הרגיל**: מסכים, רכיבים ושירותים בצד הלקוח; Controllers, Services, Repositories ו־Models בצד השרת. הטכנולוגיות נשארו React ו־Express.

## לקוח

```text
src/
  main.tsx                 כניסת React וטעינת עיצוב בלבד
  App.tsx                  תיאום המצב המשותף, ניווט וחיבור המסכים
  pages/
    brain/BrainPage.tsx
    documents/LibraryPage.tsx
  components/
    chat/                  תצוגת השיחה ותיבת ההקלדה
    graph/                 מפת הידע ופרטי המסמך/צומת
    documents/             התקדמות העיבוד
  hooks/                   מצב שיחה ו־debounce
  services/                פניות HTTP וחוזי התשובה
  types/                   טיפוסי הממשק
  core/                    תוויות, קבועים ועיצוב מספרים
```

`BrainPage` נשאר מותקן בזמן פתיחת הספרייה כדי לשמור על המצלמה ומשאבי הגרף. רכיבי התלת־ממד, ה־Worker ותור ההעלאה הקיימים ממשיכים לפעול באותם נתיבים.

## שרת

```text
server/
  index.ts                 אתחול, האזנה וסגירה מסודרת
  app.ts                   הרכבת Express וה־middleware
  Routes/api.routes.ts     רישום ה־Controllers תחת /api
  Controllers/             HTTP: קלט, סטטוסים ותגובות לפי תחום
  Services/
    ChatService.ts         תיאום מסלול יצירת התשובה
    ConversationService.ts הבנת השאלה והקשר השיחה
    AnswerContextService.ts בחירת מקורות וקטעי ראיה
    AnswerValidationService.ts בדיקת פלט המודל והציטוטים
    AiExecutionService.ts  הגבלת עיבוד AI משותפת לצ׳אט ולחילוץ
    StartupService.ts      טעינה והתאוששות בעת ההפעלה
  Repositories/            גישה לנתונים של מסלול השיחה
  Models/                  טיפוסי שלבי העיבוד
  Prompts/                 הוראות וסכמות Ollama
  Middleware/             אבטחת loopback, קצב בקשות, שגיאות וקבצי הממשק
  Settings/               הגדרות הפעלת השרת
```

מודולי האינדוקס, הגרף, האחזור וה־SQLite הקיימים נשארו בקבציהם. `rag.ts` ו־`generate-answer.ts` הם נקודות כניסה תואמות לסקריפטים ולבדיקות קיימים; לוגיקת השיחה עצמה נמצאת ב־Services.

## היכן משנים מה

| שינוי | מקום |
|---|---|
| מראה השיחה | `src/components/chat/ChatPanel.tsx` |
| התנהגות שליחה והיסטוריה | `src/hooks/useChat.ts` |
| פנייה לשרת | `src/services/chat.service.ts` |
| מסך הספרייה | `src/pages/documents/LibraryPage.tsx` |
| תצוגת המפה או פרטי מסמך | `src/components/graph/` |
| כתובת API או בדיקת קלט | `server/Controllers/` והרישום ב־`Routes/api.routes.ts` |
| שלבי RAG | `server/Services/ChatService.ts` והשירותים שאליהם הוא פונה |
| נוסח Prompt או סכמה | `server/Prompts/ChatPrompts.ts` |
| שאילתת נתונים של צ׳אט | `server/Repositories/ChatRepository.ts` |
| הגדרת האזנה או מצב Desktop | `server/Settings/ServerSettings.ts` |

## כללי תחזוקה

- נשמרים נתיבי ה־API, מבנה התשובות וסדר שלבי העיבוד. העברת קובץ אינה שינוי בחוזה API.
- לא מכניסים פניות HTTP לרכיבי התצוגה של הצ׳אט ולא מכניסים SQL לבונה ה־Prompt.
- הודעות מערכת נשארות נפרדות מתשובות שהופקו ב־Ollama.
- `npm run format` מעצב את הקוד; `npm run format:check` בודק אחידות. ההגדרות תואמות ל־Danya.Client.
- לפני סיום שינוי מריצים `npm test` ו־`npm run build`. לא מאפסים נתונים לצורך בדיקת קוד.
- בעת שינוי עיצוב נשמר סדר טעינת `style.css` ולאחריו `graph3d.css`.

בדיקת הרפקטור מול הקוד הקודם תועדה ב־`reports/refactor/contracts.json`: כל 21 נתיבי ה־API וה־handlers נשמרו, וגם 32 צירופים של Prompts וסכמות למודל. אלו בדיקות תאימות; הן אינן טענה חדשה על איכות תשובות המודל.

## Local AI update
The refactor equivalence results above describe the earlier snapshot. Current AI routing, embeddings defaults and automatic document analysis are documented in [docs/LOCAL-AI.md](docs/LOCAL-AI.md). Validation: [reports/local-ai/RESULT.md](reports/local-ai/RESULT.md).

# DemoTech Knowledge Brain

מערכת ידע מקומית: העלאת מסמכים, חיפוש משולב, שאלות ותשובות עם מקורות וגרף ידע ב־2D/3D. Ollama מריץ את `gemma3:4b` להבנת שאלות, יצירת תשובות וחילוץ ישויות, ואת `embeddinggemma:latest` לחיפוש סמנטי. קשרי AI מסומנים כלא מאומתים.

טכנולוגיות: React 19, TypeScript, Node.js, Express 5, SQLite FTS5, חיפוש cosine, Cytoscape, Three.js/3d-force-graph. Electron ו־electron-builder מאפשרים הפעלה ובנייה ל־Windows Desktop.

## התחלה מהירה — Windows PowerShell

התקינו [Git](https://git-scm.com/install/windows), [Node.js 22.x](https://nodejs.org/en/download) ו־[Ollama](https://ollama.com/download). נבדקו Node 22.23.2 ו־npm 10.9.8. [VS Code](https://code.visualstudio.com/download) אופציונלי. פרטים ב־[מדריך המלא](docs/INSTALL-WINDOWS.md).

מאגר הפרויקט: [elidahan223/DemoTech-Knowledge-Brain](https://github.com/elidahan223/DemoTech-Knowledge-Brain). למאגר פרטי נדרשת הזמנה/הרשאת גישה בחשבון GitHub של המפתח.

```powershell
git clone https://github.com/elidahan223/DemoTech-Knowledge-Brain.git DemoTech-Knowledge-Brain
Set-Location DemoTech-Knowledge-Brain
npm ci
Copy-Item .env.example .env
ollama pull gemma3:4b
ollama pull embeddinggemma
ollama list
npm run dev
```

Ollama צריך לפעול ברקע. אם אינו פעיל, פתחו את יישום Ollama או הפעילו `ollama serve` בחלון נפרד. פתחו [http://127.0.0.1:3210](http://127.0.0.1:3210). פקודה אחת מפעילה API וממשק; `Ctrl+C` עוצר את השרת. קובץ ההגדרות יוצר מאגר חדש וריק. העלו TXT, DOCX או PDF עם טקסט; OCR אינו ממומש.

בכל הפעלה נוספת: Ollama פעיל ו־`npm run dev`. התקנת תלויות ומשיכת מודלים נדרשות בתחילה או בעת עדכון בלבד.

## תיעוד ופקודות נוספות

- [התקנה מלאה ובדיקות קבלה](docs/INSTALL-WINDOWS.md)
- [פתרון תקלות](docs/TROUBLESHOOTING.md)
- [ארכיטקטורה](docs/ARCHITECTURE.md)
- [פרטי AI מקומי](docs/LOCAL-AI.md)
- [אימות המדריך ומגבלותיו](reports/onboarding/VALIDATION.md)

Desktop מתוך הקוד: `npm run desktop`. בניית מתקין: `npm run dist:win`, פלט ב־`release/`. אין מתקין מוכן בעותק הנוכחי ולא נוצר Release במשימה זו. Ollama והמודלים מותקנים בנפרד גם ב־Desktop.

בדיקות: `npm test`, `npm run test:desktop`. בניית ממשק ובדיקת TypeScript: `npm run build`. סקריפטי אבחון ישנים מסוימים תלויים במאגרים מקומיים. אין להריץ `seed`, `reindex` או סקריפטי עומס לצורך התקנה חדשה.

מסמכי משתמש, מסדי נתונים, גיבויים, פלטי אבחון וקובצי סביבה מוחרגים מ־Git. נכללים קוד, תיעוד, דוחות Markdown נבחרים ומסמכי דמה סינתטיים בלבד. לפני הוספת מסמכים חדשים בדקו את `git diff --cached`; אין להניח שכל קובץ ב־docs או test-data מותר לשיתוף.

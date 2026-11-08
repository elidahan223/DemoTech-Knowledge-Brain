# התקנה למפתח חדש — Windows

נבדק מול הקוד ב־08.11.2026. אין צורך במסד, במסמכי DemoTech או ב־Enterprise-3000 מהמחשב המקורי. אין לשנות מאגר קיים לצורך ההתקנה.

## 1. דרישות והורדות — פעם אחת

| רכיב | דרישה והורדה |
| --- | --- |
| Windows | יעד המדריך והמתקין: Windows x64. Ollama מציין Windows 10 22H2 ומעלה; מחשב Windows חדש טרם נבדק במסגרת המשימה |
| Node.js | השתמשו ב־22.x עדכני, לפחות 22.13.0 לשימוש ב־`node:sqlite` ללא דגל. בפועל נבדק 22.23.2; אין `engines` ב־package.json ולכן זו דרישת המדריך ולא אכיפת npm. [הורדה רשמית](https://nodejs.org/en/download), [תיעוד SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html). סקריפטים מסוימים משתמשים גם ב־SQLite backup; לא אומתה כל גרסת 22.x |
| npm | מגיע עם Node. נבדק 10.9.8, lockfileVersion=3; אין גרסת מינימום מוצמדת בפרויקט. לא נבדקה מטריצת גרסאות npm |
| Git | נדרש לשכפול ועדכונים; אינו נדרש בזמן ריצת המערכת. [Git for Windows](https://git-scm.com/install/windows) |
| Ollama | התקנה נפרדת, גם ב־Desktop. EmbeddingGemma דורש לפחות 0.11.10 לפי [דף המודל](https://ollama.com/library/embeddinggemma). השתמשו בגרסה נתמכת עדכנית: [הורדה](https://ollama.com/download), [דרישות Windows](https://docs.ollama.com/windows) |
| עורך | [VS Code](https://code.visualstudio.com/download) אופציונלי; אין תלות בו להרצה |

אין צורך בהתקנת Python, Docker, SQL Server או SQLite CLI לפי מסלול ההפעלה בקוד. SQLite מובנה ב־Node; חבילות JS ו־Electron מותקנות ב־npm. האצת GPU עשויה לדרוש דרייבר מתאים לפי תיעוד Ollama. לא נדרשת התקנת Visual Studio Build Tools במסלול הרגיל עם binaries מוכנים.

אין בקוד מינימום RAM/CPU/GPU מוכח. **הערכת התחלה לפיתוח יחיד**, שאינה בדיקת מינימום: RAM של 16GB ומעלה, מעבד x64 עם 4 ליבות ומעלה ו־SSD עם 15–20GB פנויים בנוסף למסמכים ולגיבויים. דפי המודלים מציגים כ־3.4GB ל־[Gemma 3 4B](https://ollama.com/library/gemma3/tags) וכ־622MB ל־EmbeddingGemma; משקל קובץ אינו צריכת RAM. Ollama עצמו, npm ו־Electron צורכים מקום נוסף. אין להציג הערכות אלו כיכולת שרת או תמיכה בעשרה משתמשים במקביל.

הקוד אינו מחייב GPU. ניתן להריץ מודלים ב־CPU כאשר Ollama תומך במחשב, אך מסלול CPU בלבד לא נמדד כאן וצפוי להיות איטי יותר. בדקו ב־`ollama ps` כיצד המודל נטען במחשבכם. Electron אופציונלי; דפדפן מספיק לפיתוח.

לאחר התקנת התוכנות פתחו PowerShell חדש ובדקו:

```powershell
git --version
node --version
npm --version
ollama --version
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');console.log(db.prepare('select sqlite_version() version').get());db.close()"
```

## 2. שכפול והגדרה — פעם אחת

מאגר הפרויקט הוא `elidahan223/DemoTech-Knowledge-Brain`. למאגר פרטי נדרשת הרשאת גישה של המפתח. לאחר קבלת גישה:

```powershell
git clone https://github.com/elidahan223/DemoTech-Knowledge-Brain.git DemoTech-Knowledge-Brain
Set-Location DemoTech-Knowledge-Brain
git remote -v
code .
npm ci
Copy-Item .env.example .env
```

`code .` אופציונלי. `npm ci` משתמש ב־package-lock.json; אין להשתמש ב־`--omit=dev` בסביבת פיתוח, כי tsx, Vite ו־TypeScript נמצאים ב־devDependencies. אפשר `npm install` בעת שינוי תלויות מכוון, אך הוא עשוי לעדכן lockfile. לפני העתקת `.env` במחשב עם הגדרות קיימות יש לשמר אותן; אין לדרוס אותן בזמן עדכון.

`.env` נטען ב־Backend באמצעות dotenv מתוך תיקיית העבודה. הריצו מהשורש. משתני סביבה שכבר קיימים בחלון PowerShell גוברים על `.env`. אין להוסיף סודות ל־`.env.example` או ל־Git.

## 3. Ollama והמודלים — הורדה פעם אחת

Ollama הוא מנוע הרצה מקומי. Gemma מבין את השאלה, מייצר תשובות ומחלץ ישויות. EmbeddingGemma ממיר טקסט לווקטורים לחיפוש סמנטי; אינו מודל הצ׳אט.

```powershell
ollama --version
ollama pull gemma3:4b
ollama pull embeddinggemma
ollama list
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

`embeddinggemma` ללא תג מוריד את `embeddinggemma:latest`, שזה שם ברירת המחדל בקוד. האפליקציה אינה מורידה מודלים בעצמה. אם השירות אינו פועל, פתחו Ollama מתפריט Start, או בחלון PowerShell נפרד:

```powershell
ollama serve
```

אין להפעיל מופע שני כשכבר קיים שירות ב־11434 ואין לעצור שירות שמשמש אחרים. בדיקה ישירה אופציונלית: `ollama run gemma3:4b 'Reply with OK'`. זו בדיקת מודל בלבד, ולא הוכחה שהאפליקציה השתמשה בו.

## 4. משתני סביבה

אין משתנה חובה בקוד להרצת דפדפן עם ברירות המחדל, אך הגדרות המאגר הריק בדוגמה מומלצות להתקנה עצמאית. כל שורה כאן היא משתנה שנמצא בפועל ב־server או electron; משתנים של סקריפטי אבחון פרטניים אינם דרישות התקנה.

| משתנה | ברירת מחדל בקוד | הדוגמה ומתי לשנות |
| --- | --- | --- |
| NODE_ENV | ללא ערך → Vite בפיתוח | `development`; `production` מגיש dist קיים |
| PORT | 3210 | פורט API וממשק משותף; 1024–65535. Electron מגדיר 0 פנימית לבחירת פורט פנוי |
| OLLAMA_URL | http://127.0.0.1:11434 | שירות מקומי בלבד: http ב־loopback; שרת מרוחק ושמות cloud אינם נתמכים במדיניות הנוכחית |
| OLLAMA_MODEL | gemma3:4b | לשנות רק למודל מקומי מותקן ולבדוק איכות מחדש |
| RAG_EMBED_MODEL | embeddinggemma:latest | מומלץ להשאיר; ריק מפורש משבית חיפוש וקטורי לצורכי אבחון. החלפת מודל אינה ממירה וקטורים קיימים |
| BRAIN_DATA_DIR | `<app root>/data` | דוגמה `./repositories/developer-local`; מאגר חדש נפרד לכל מפתח |
| BRAIN_REPOSITORY_NAME | DemoTech | דוגמה `Developer-Local`; נקשר לתיקיית הנתונים. שינוי שם על מאגר קיים גורם לשגיאת אי־התאמה |
| BRAIN_SEED_DEMO | מופעל אלא אם 0 | דוגמה 0: מתחילים ריקים. אחרת seed תלוי ב־knowledge_graph.json ובמסמכי DOCX ב־docs; לא מניחים שהם נכללים בשכפול |
| BRAIN_AUTO_AI_ANALYSIS | מופעל אלא אם 0 | 1 לניתוח AI אוטומטי למסמכים חדשים; אינו מעבד מחדש מסמכים ישנים |
| BRAIN_PAUSE_BACKGROUND | לא מושהה אלא אם 1 | 0 בשימוש רגיל; 1 לאבחון בלבד, כי ההעלאות ימתינו בתור |
| BRAIN_TRACE_AI | כבוי אלא אם 1 | 1 זמנית לבדיקת קריאות אמיתיות; לוגי מטא־נתונים ו־hash, ללא Prompt וטקסט מסמך |
| BRAIN_APP_ROOT | תיקיית העבודה | אופציונלי: שורש משאבים; אינו תיקיית מסד הנתונים |
| BRAIN_STATIC_DIR | `<app root>/dist` | אופציונלי ב־production בלבד |
| BRAIN_DESKTOP_USER_DATA | `%APPDATA%/DemoTech Knowledge Brain` | אופציונלי, נקרא ב־Electron Main מסביבת התהליך; פרופיל מבודד לפיתוח Desktop |
| BRAIN_DESKTOP_LEGACY_DATA | בפיתוח `<app>/data`, בארוז ללא מקור | אופציונלי מסביבת התהליך, מקור העתקת נתונים ישנים כשיעד ריק |
| BRAIN_DESKTOP | כבוי | פנימי: Electron מגדיר 1; אין להגדיר ידנית להרצת דפדפן |
| BRAIN_DESKTOP_TOKEN | ללא ערך | פנימי וחובה רק במצב Desktop: Electron מייצר token אקראי. אין לשמור ערך קבוע בדוגמה |

כתובת ה־Backend וה־Frontend זהה: `http://127.0.0.1:<PORT>`. אין `HOST`, `FRONTEND_URL`, `VITE_API_URL` או Proxy מוגדר. שינוי PORT משנה את הכתובת שיש לפתוח. פורט תפוס גורם לשגיאה ויציאה; השרת אינו עובר אוטומטית לפורט הבא. Electron משתמש בפורט פנוי שנבחר במערכת ההפעלה.

המסד הוא `<BRAIN_DATA_DIR>/brain.sqlite`, המקור ב־`files/`, FTS5 והווקטורים באותו מסד; אין משתני DB_URL או INDEX_PATH נוספים. האינדקס הווקטורי בזיכרון נטען מהמסד בעת הפעלה. ודאו הרשאת כתיבה ומקום בדיסק.

## 5. הפעלה בכל יום

### אפשרות א: פיתוח בדפדפן

ודאו ש־Ollama פעיל. בחלון הפרויקט:

```powershell
npm run dev
```

בחלון אחר:

```powershell
Start-Process 'http://127.0.0.1:3210'
Invoke-RestMethod http://127.0.0.1:3210/api/health | ConvertTo-Json -Depth 5
```

`npm run dev` מפעיל tsx ל־server/index.ts; Express משלב Vite ומשמש גם Frontend וגם Backend. אין להפעיל `npx vite` בנפרד. `npm start` קיים ומפעיל אותו entry point; המצב נקבע ב־NODE_ENV, לא בשם הפקודה. שינוי קוד שרת עשוי לדרוש עצירה והפעלה מחדש; ה־script אינו tsx watch.

עצירה: `Ctrl+C` בחלון שרת הפרויקט. אם התחלתם בעצמכם `ollama serve` בחלון נפרד והוא אינו משותף, אפשר `Ctrl+C` גם בו. סגירת הדפדפן לבדה אינה עוצרת את השרת.

לבדיקת בנייה מקומית ללא Vite בזמן ההרצה:

```powershell
npm run build
node scripts/build-desktop.mjs
$env:NODE_ENV='production'
node build/server/index.mjs
```

אותו פורט ואותו מאגר מה־`.env`. עצרו מופע קודם קודם לכן. לסיום `Ctrl+C`, ואז `Remove-Item Env:NODE_ENV` אם חוזרים לפיתוח באותו חלון. `npm run build` לבדו אינו בונה את Backend ה־mjs.

### אפשרות ב: Desktop

לא נמצא מתקין מוכן ב־`release/` בעת הכנת המדריך. אין קישור Release זמין. אין להסתמך על מתקין ישן המוזכר בדוחות; שינויי הקוד האחרונים אינם בהכרח כלולים בו.

מהקוד, עם Node ותלויות מותקנים:

```powershell
$env:BRAIN_DESKTOP_USER_DATA=Join-Path $PWD 'repositories/desktop-developer'
$env:BRAIN_DESKTOP_LEGACY_DATA=Join-Path $PWD 'repositories/no-legacy'
$env:BRAIN_SEED_DEMO='0'
npm run desktop
```

שני המשתנים הראשונים מונעים שימוש בפרופיל Desktop קיים והעתקת מאגר ה־data הישן. `.env` אינו נטען ל־Electron Main לפני בחירת פרופיל, ולכן מגדירים אותם בסביבת PowerShell. Main קובע ל־Backend נתיב data ופורט משלו, וגובר על BRAIN_DATA_DIR/PORT שהורשו לו. שם המאגר צריך להישאר עקבי. אחרי בנייה ראשונה וללא שינוי קוד אפשר `npm run desktop:run`; אחרי שינוי קוד יש לבנות שוב.

ליצירת מתקין (אופציונלי, דורש הורדות כלי הבנייה ואישור הפצה בנפרד):

```powershell
npm run dist:win
Get-ChildItem .\release\*.exe
```

לפי package.json/electron-builder.yml הנוכחיים הפלט הצפוי הוא `release/DemoTech-Knowledge-Brain-Setup-1.2.0-x64.exe`. להפקת תיקייה לא ארוזה: `npm run desktop:pack`. תהליך ההתקנה אינטראקטיבי למשתמש הנוכחי, מאפשר בחירת תיקייה ויוצר קיצורי דרך. חתימת קוד אינה מוגדרת באמצעות תעודה במאגר; אם מדיניות Windows/IT חוסמת, פנו ל־IT. לא משנים מדיניות אבטחה כדי לעקוף חסימה.

אפליקציה מותקנת כוללת את סביבת Electron ואת Backend; Node, npm ו־VS Code אינם נדרשים למשתמש הקצה, אבל Ollama ושני המודלים כן. עם ההפעלה Main מפעיל Backend וממתין למוכנות; אינו מפעיל את Ollama. סגירת החלון/יציאה בתפריט מפסיקה את Backend. הנתונים נשמרים בנפרד ב־`%APPDATA%/DemoTech Knowledge Brain/data`; יומן ב־`logs/desktop.log`, הגדרות `ollamaUrl` ו־`ollamaModel` ב־`settings.json` באותו פרופיל. הגדרות אלו גוברות על כתובת/מודל שניתנו ל־Electron בסביבה. Embeddings יורש את הגדרת Backend. הסרת האפליקציה אינה מוחקת את נתוני המשתמש לפי הגדרת NSIS.

## 6. שכפול נקי ונתוני בדיקה

`.gitignore` מחריג `node_modules`, `dist`, `build`, `release`, `data`, `repositories`, `.env` ולוגים. במחשב חדש יוצרים תלויות ובנייה מחדש. SQLite יוצר מאגר ריק בעת ההפעלה כאשר `BRAIN_SEED_DEMO=0`; אין צורך להעביר DB או אינדקסים. אין להפעיל סקריפטי Enterprise או סקריפטים המקובעים ל־repositories/DemoTech-Organization.

ה־Git מחריג מאגרים, מסדי נתונים, גיבויים, קובצי סביבה ולוגים. נכללים קוד, תיעוד ומסמכי הדמה הסינתטיים הנדרשים לבדיקות ולמשאבי Desktop. נשמרים רק דוחות Markdown שנבחרו; פלטי אבחון גולמיים נשארים מקומיים. ה־Desktop builder מעתיק גם `docs` ו־knowledge_graph.json כמשאבי seed. בעת הוספת מסמכים בעתיד יש לבדוק במפורש מה נכלל ב־git diff --cached; אין להניח שמסמך חדש מותר לשיתוף רק בגלל מיקומו.

צרו מסמך בדיקה חדש שאינו רגיש, בספריית הנתונים המוחרגת:

```powershell
New-Item -ItemType Directory -Force .\repositories\onboarding-sample | Out-Null
$sample='ארגון דמה לצורכי בדיקה בלבד. שם הארגון הוא אוריון בדיקות. מיכל ישראלי אחראית על הכספים. מוצר הדמה נקרא פנקס ומיועד לניהול הזמנות ציוד. קוד הבקרה הוא DEMO-742.'
[IO.File]::WriteAllText((Join-Path $PWD 'repositories/onboarding-sample/onboarding.txt'),$sample,[Text.UTF8Encoding]::new($false))
```

העלו אותו בספריית המסמכים דרך הממשק. זהו תוכן דמה גלוי לבדיקה, לא נתוני ארגון אמיתיים ולא תוצאה מדומה של מנגנון AI.

## 7. בדיקות קבלה

1. שורת `DemoTech Knowledge Brain: http://127.0.0.1:3210` מופיעה ללא שגיאת שרת.
2. הממשק נפתח בכתובת זו; התקנה נקייה אמורה להציג אפס מסמכים.
3. `ollama list` מציג את שני שמות המודלים.
4. `/api/health` מציג `ollama.online=true`, `available=true` וגם `embedding.available=true`. HTTP 200 לבדו אינו מוכיח זמינות.
5. העלו את onboarding.txt; הקבלה אינה סיום אינדוקס. המתינו למצב ready ולניתוח AI done; שגיאת AI מוצגת בנפרד.
6. בדקו יצירת קטעים ווקטורים:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/api/library | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3210/api/metrics | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3210/api/jobs/summary | ConvertTo-Json -Depth 5
```

במאגר בן מסמך אחד תקין יש chunks>0 ו־embeddings>0; בדקו שמצב העבודה done. אין להסיק מכך איכות תשובות.

7. לאימות מעבר אמיתי למודל: עצרו את שרת הפרויקט בלבד, הגדירו `$env:BRAIN_TRACE_AI='1'`, והפעילו שוב `npm run dev`. שלחו שאלה בממשק: ״מי אחראי על הכספים?״. אפשר גם:

```powershell
$body=@{question='מי אחראי על הכספים?'} | ConvertTo-Json
$reply=Invoke-RestMethod http://127.0.0.1:3210/api/chat -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$reply | ConvertTo-Json -Depth 8
```

8. אמתו `mode=ollama`, `answerKind=ai`, מודל `gemma3:4b`, מקור onboarding.txt וציטוט התומך במיכל ישראלי. לוגים עם אותו requestId צריכים להראות `ollama.request` ו־`ollama.response`, HTTP מוצלח ותוכן שהתקבל. בשאלת חיפוש רגילה נראות בדרך כלל ארבע קריאות צ׳אט: הבנה, דירוג מקורות, יצירת תשובה ובדיקת רלוונטיות הטענות. מסלולי סיכום ותרגום עשויים להשתמש במספר אחר. `modelCalls` או בדיקה ישירה ב־Ollama בלבד אינם ראיית תעבורה עצמאית. אחרי הבדיקה כבו את הדגל והפעילו מחדש.
9. פתחו את גרף הידע. המפה ממוקדת בחיפוש/בחירת מסמך: בחרו את המסמך בספרייה או חפשו אוריון. בדקו צמתים וקשרים ואת הראיה; קשרי AI צריכים להיות מסומנים כלא מאומתים. מפה ללא צמתים מוצגים אינה בהכרח מאגר ריק.
10. שאלו גם שאלה שאין לה תשובה במסמך; אין להמציא נתון. תשובת הימנעות מצביעה על חוסר תמיכה, לא על הצלחת בדיקת שאלה חיובית.

## 8. ללא אינטרנט

נדרשת רשת להתקנת תוכנות, clone, npm ci, הורדת מודלים ולעיתים כלי electron-builder. אחרי שכל הקבצים והמודלים נמצאים מקומית, מסלול האפליקציה המתועד משתמש ב־loopback ובדיסק. אין אישור גורף לתקינות אופליין על כל מחשב.

בדיקת קבלה במחשב היעד: בנו את הממשק וה־Backend מראש, הפעילו Ollama, נתקו זמנית את הרשת החיצונית בלי לחסום loopback, הפעילו את הבנייה המקומית, פתחו ממשק, העלו מסמך חדש, המתינו ל־Embeddings ולניתוח גרף, שאלו שאלה ובדקו מקור. בצעו זאת רק במחשב בדיקה ובתיאום, בלי לנתק אחרים. תעדו תוצאות וחברו שוב את הרשת. בדיקת כשל Ollama היא בדיקה אחרת ואינה מוכיחה אופליין.

## 9. מה אומת

ראו [דוח אימות ההתקנה המקורי](../reports/onboarding/VALIDATION.md). הוא מתעד את המצב שלפני יצירת מאגר GitHub. התקנה על מחשב Windows חדש עדיין דורשת אימות נפרד; לא נוצר Release או מתקין חדש. לתקלות: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

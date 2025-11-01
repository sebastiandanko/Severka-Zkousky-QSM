// Zde je kód který automatizuje proces vytváření otázek pomocí vývojařských funkci v prohlížeči. (Console)
// Nelze přidávat obrázky touto cestou ani vybírat správné odpovědi protože to nejde přes client-side nebo něco takového,
// (Strávil jsem na tom 4h, doporučuju se o to nepokoušet, bude to rychlejší už ty dvě věci prostě vyklikat)


// ====== KONFIG ======
 const quizData = [
{ question: "Příkladová otázka č1", answers: ["Odpověď 1", "Odpověď 2", "Odpověď 3"] },
{ question: "Příkladová otázka č2", answers: ["Odpověď 1", "Odpověď 2", "Odpověď 3"] },
{ question: "Příkladová otázka č1", answers: ["Odpověď 1", "Odpověď 2", "Odpověď 3"] },
];
const WAIT_SHORT = 300;
const WAIT_MED = 800;
const WAIT_LONG = 1600;
const MAX_WAIT_FOR_NEW = 8000;

// ====== HELPERS ======
const delay = ms => new Promise(r => setTimeout(r, ms));

function clickElem(el) {
  if (!el) return false;
  try {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  } catch (e) {
    try { el.click(); return true; } catch (e2) { return false; }
  }
}

function snapshotAllPages() {
  // Snažíme se najít elementy stránek - různé třídy, fallbacky
  const selCandidates = [
    '.qsm-pages .qsm-page',   // hypotetický kontejner
    '.qsm-page', 
    '.page-wrap', 
    '.qsm-pages > li',
    '.qsm-page-wrap'
  ];
  for (const s of selCandidates) {
    const arr = Array.from(document.querySelectorAll(s));
    if (arr.length) return arr;
  }
  // fallback: najdi cokoli, co vypadá jako stránka podle textu "Page" v titulku
  const possible = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!el.innerText) return false;
    return /\bpage\b/i.test(el.innerText) && el.childElementCount > 0;
  });
  return possible;
}

function countQuestionsInPage(pageEl) {
  if (!pageEl) return 0;
  // různé možné selektory pro otázku uvnitř stránky
  const qSelectors = ['.qsm-question', '.question-item', '.question-wrap', '.quiz-question'];
  for (const s of qSelectors) {
    const found = pageEl.querySelectorAll(s);
    if (found && found.length) return found.length;
  }
  // fallback: spočítat edit-question-button uvnitř
  return pageEl.querySelectorAll('.edit-question-button').length;
}

function findLocalAddQuestionButton(pageEl) {
  if (!pageEl) return null;
  // někdy každá stránka obsahuje svůj vlastní "Add Question" tlačítko
  const candidates = pageEl.querySelectorAll('a,button,input');
  for (const c of candidates) {
    const txt = (c.innerText || c.value || c.title || '').trim().toLowerCase();
    if (txt.includes('add question') || txt.includes('add question') || c.classList.contains('new-question-button')) return c;
  }
  return null;
}

function findAddQuestionGlobal() {
  return document.querySelector('.new-question-button') || Array.from(document.querySelectorAll('a,button')).find(n => (n.innerText||'').toLowerCase().includes('add question'));
}

function findCreatePageButton() {
  return document.querySelector('.new-page-button') || Array.from(document.querySelectorAll('a,button')).find(n => (n.innerText||'').toLowerCase().includes('create page') || (n.innerText||'').toLowerCase().includes('add page'));
}

function findSaveButtonInPopup() {
  // několik možných možností
  return document.querySelector('#save-popup-button') || document.querySelector('.qsm-save-question') || Array.from(document.querySelectorAll('button,input')).find(n => (n.id === 'save-popup-button' || (n.innerText||'').toLowerCase().includes('save')));
}

// Wait until the pages list length increases (detect new page)
async function waitForNewPage(oldPages, timeout = MAX_WAIT_FOR_NEW) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const current = snapshotAllPages();
    if (current.length > oldPages.length) {
      // try to find the new element by difference
      for (const p of current) {
        if (!oldPages.includes(p)) return p;
      }
      return current[current.length - 1];
    }
    await delay(200);
  }
  return null;
}

// Wait until the number of questions inside a page increases
async function waitForNewQuestionInPage(pageEl, oldCount, timeout = MAX_WAIT_FOR_NEW) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const cnt = countQuestionsInPage(pageEl);
    if (cnt > oldCount) {
      // return the newly added question element (best-effort: last edit-question-button inside page)
      const edits = pageEl.querySelectorAll('.edit-question-button');
      if (edits.length) {
        const lastEdit = edits[edits.length - 1];
        // try to return the parent question container
        let container = lastEdit.closest('.qsm-question') || lastEdit.closest('.question-item') || lastEdit.parentElement;
        return { container, lastEdit };
      }
      return { container: null, lastEdit: null };
    }
    await delay(200);
  }
  return null;
}

// ====== HLAVNÍ FUNKCE ======
async function addQuestionToNewPage(qData, index, total) {
  console.log(`\n➡️ [${index+1}/${total}] Start: "${qData.question}"`);

  // 0) snapshot před
  const beforePages = snapshotAllPages();
  const beforePagesCounts = beforePages.map(p => countQuestionsInPage(p));

  // 1) kliknout Create Page
  const createBtn = findCreatePageButton();
  if (!createBtn) { console.error("❌ Create Page button nenalezen."); return false; }
  clickElem(createBtn);
  console.log("• Clicked Create Page");
  await delay(WAIT_MED);

  // 2) počkej a identifikuj novou stránku
  const newPage = await waitForNewPage(beforePages);
  if (!newPage) {
    console.warn("⚠️ Nová stránka nenalezena v očekávaném čase, pokusím se použít poslední stránku.");
  }
  const targetPage = newPage || (snapshotAllPages().slice(-1)[0]);
  if (!targetPage) { console.error("❌ Nelze identifikovat target page."); return false; }

  // 3) aktivuj ji (klik na její titul nebo na ní)
  // Hledáme elementy uvnitř targetPage, které se dají kliknout - např. page title
  let clickedActivate = false;
  const titleCandidates = targetPage.querySelectorAll('a,button,div');
  for (const c of titleCandidates) {
    const txt = (c.innerText || c.title || '').trim().toLowerCase();
    if (txt && txt.length < 60 && /\bpage\b|\bstránk|\btitle\b/i.test(txt)) {
      clickedActivate = clickElem(c);
      if (clickedActivate) break;
    }
  }
  // fallback: kliknout přímo na kontejner stránky
  if (!clickedActivate) {
    clickElem(targetPage);
    clickedActivate = true;
  }
  console.log("• Aktivovaná nová stránka (pokud to bylo možné).");
  await delay(WAIT_MED);

  // 4) před přidáním otázky si poznamenej počet otázek v té stránce
  const beforeQcount = countQuestionsInPage(targetPage);
  console.log(`• Počet otázek v cílové stránce před přidáním: ${beforeQcount}`);

  // 5) Pokus najít lokální Add Question uvnitř targetPage; pokud ne, klikni na globální Add Question (ale už máme stránku aktivovanou)
  let localAdd = findLocalAddQuestionButton(targetPage);
  if (localAdd) {
    clickElem(localAdd);
    console.log("• Kliknuto na lokální Add Question v rámci nové stránky.");
  } else {
    const globalAdd = findAddQuestionGlobal();
    if (!globalAdd) { console.error("❌ Add Question tlačítko nebylo nalezeno (lokální ani globální)."); return false; }
    clickElem(globalAdd);
    console.log("• Kliknuto na globální Add Question (po aktivaci stránky).");
  }
  await delay(WAIT_MED);

  // 6) počkej, až se v cílové stránce objeví nová otázka (porovnej s beforeQcount)
  const newQ = await waitForNewQuestionInPage(targetPage, beforeQcount);
  if (!newQ) {
    console.warn("⚠️ Nová otázka nebyla detekována uvnitř target page v časovém limitu. Pokusím se najít poslední otázku celého dokumentu.");
    // fallback: najdi poslední edit button v dokumentu
    const allEdits = Array.from(document.querySelectorAll('.edit-question-button'));
    if (!allEdits.length) { console.error("❌ Nenalezena žádná edit-question-button nikde."); return false; }
    const lastEdit = allEdits[allEdits.length - 1];
    newQ.container = lastEdit.closest('.qsm-question') || lastEdit.parentElement;
    newQ.lastEdit = lastEdit;
  }

  // 7) klikni na edit pro tu konkrétní otázku
  const editBtn = (newQ && newQ.lastEdit) ? newQ.lastEdit : (targetPage.querySelector('.edit-question-button') || document.querySelector('.edit-question-button'));
  if (!editBtn) { console.error("❌ Edit button pro novou otázku nenalezen."); return false; }
  clickElem(editBtn);
  console.log("• Otevřen editor nové otázky (klik na edit).");
  await delay(WAIT_MED + 400);

  // 8) najdi question title pole a vyplň ho
  const qField = document.querySelector('#question_title') || document.querySelector('textarea[name="question-title"], textarea.question-title');
  if (!qField) { console.error("❌ Pole pro otázku (#question_title) nenalezeno v popupu."); return false; }
  qField.value = qData.question;
  qField.dispatchEvent(new Event('input', { bubbles: true }));
  console.log(`✏️ Otázka vložena: ${qData.question}`);
  await delay(WAIT_SHORT);

  // 9) počkat na answer inputs
console.log("⌛ Čekám na načtení odpovědních polí...");
let answerInputs = Array.from(document.querySelectorAll('.answer-text'));
const waitStart = Date.now();
while (answerInputs.length < 1 && Date.now() - waitStart < MAX_WAIT_FOR_NEW) {
  await delay(200);
  answerInputs = Array.from(document.querySelectorAll('.answer-text'));
}
if (!answerInputs.length) {
  console.error("❌ Nepodařilo se najít žádná pole .answer-text ani po čekání.");
  return false;
}

// 10) Pokud jich je méně než odpovědí, přidej další
const neededAnswers = qData.answers.length;
while (answerInputs.length < neededAnswers) {
  const addAnswerBtn =
    document.querySelector('.add-new-answer') ||
    Array.from(document.querySelectorAll('a,button')).find(el => (el.innerText || '').toLowerCase().includes('add answer'));
  if (!addAnswerBtn) break;
  addAnswerBtn.click();
  console.log("➕ Přidávám pole pro odpověď...");
  await delay(500);
  answerInputs = Array.from(document.querySelectorAll('.answer-text'));
}

if (!answerInputs.length) {
  console.error("❌ Ani po přidání nejsou dostupná .answer-text pole.");
  return false;
}

// 11) Vyplň odpovědi a vyvolej eventy
for (let i = 0; i < neededAnswers; i++) {
  const el = answerInputs[i];
  if (!el) continue;
  const val = qData.answers[i];
  el.focus();
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  console.log(`💬 Odpověď ${i + 1}: "${val}"`);
  await delay(200);
}
console.log("✅ Všechny odpovědi úspěšně vloženy.");

  console.log("✅ Odpovědi vyplněny:", qData.answers);
  await delay(WAIT_SHORT);

  // 12 ) Ulož otázku
  const saveBtn = findSaveButtonInPopup();
  if (!saveBtn) {
    console.error("❌ Save button nenalezen v popupu.");
    return false;
  }
  clickElem(saveBtn);
  console.log("💾 Kliknuto Save. Čekám na uložení...");
  await delay(WAIT_LONG);

  console.log(`✅ Hotovo: otázka "${qData.question}" přidána do nové stránky.\n`);
  return true;
}


// ====== SPUŠTĚNÍ ======
(async () => {
  console.log("==== Spouštím robustní přidávání otázek (one question per page) ====");
  for (let i=0;i<quizData.length;i++){
    try {
      const ok = await addQuestionToNewPage(quizData[i], i, quizData.length);
      if (!ok) console.warn(`! Přidání otázky #${i+1} selhalo (viz chybové hlášky). Pokračuji dalším.`);
      await delay(800);
    } catch(e){
      console.error("!! Neočekávaná chyba při otázce:", i+1, e);
    }
  }
  console.log("==== Skript dokončen ====");
})();
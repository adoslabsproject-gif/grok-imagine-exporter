# Grok Imagine Exporter

Estensione Chrome (Manifest V3) per **esportare in blocco** le tue immagini e i tuoi video generati su [Grok Imagine](https://grok.com/imagine), direttamente nella cartella Download, con un clic.

Niente copia-incolla in console, niente cookie da estrarre a mano: l'estensione usa la **tua sessione** già attiva.

## Funziona così

- Enumera i tuoi asset tramite l'API ufficiale del sito (`/rest/assets`, con paginazione).
- Scarica via `chrome.downloads` in sottocartelle ordinate (`videos/`, `images/`, `uploads/`).
- Ricorda cosa hai già scaricato → puoi rilanciare e prende solo i nuovi (ripresa).
- Grazie ai `host_permissions` l'estensione bypassa il CORS che blocca i normali script di pagina.

## Installazione (sviluppatore, una volta sola)

1. Scarica/clona questa cartella.
2. Apri **`chrome://extensions`**.
3. Attiva in alto a destra **Modalità sviluppatore**.
4. Clicca **Carica estensione non pacchettizzata** e seleziona questa cartella.
5. Fissa l'icona nella barra. Fatto.

Funziona anche su Edge, Brave, Opera (stesso motore Chromium).

## Uso

1. Apri **grok.com** ed effettua il login.
2. Clicca l'icona dell'estensione.
3. (Opzionale) cambia la cartella di destinazione.
4. Premi **Scarica video** / **Scarica immagini** / **Upload**.
5. Se Chrome chiede di **consentire download multipli**, accetta.

I file finiscono in `Download/GrokExport/...`.

## Limitazioni note

- Le immagini **non salvate** del prompter diventano scaricabili solo dopo averle salvate/preferite nel sito.
- L'estensione scarica **solo i contenuti del tuo account** (serve la tua sessione).

## Distribuzione

Vedi sotto, nella sezione "Come divulgarla".

## Licenza

MIT — vedi [LICENSE](LICENSE). Usala, modificala, ridistribuiscila liberamente.

## Disclaimer

Strumento per scaricare **i tuoi contenuti**. Rispetta i Termini di Servizio di Grok/xAI e le leggi locali. Non affiliato a xAI.

## Galleria con nesting (foto → video annidati)

La galleria (`gallery.html`) usa l'API ufficiale reverse-engineered dal bundle dell'app:
- `GET /rest/assets` — elenca i tuoi asset (foto/video generati).
- `POST /rest/media/post/get` con `{ "id": <postId> }` — restituisce una foto con i suoi **video annidati** (`videos[]`, con `mediaUrl`, `thumbnailImageUrl`, `prompt`).

Flusso: griglia di foto → clicchi una foto → si aprono i **video legati a quella foto** → selezioni foto e/o video → **Scarica selezionati**. Anteprime caricate via `fetch` autenticato (niente problemi di cookie di terze parti).

# Draft (draft.appdoivo.com, was Job, then Type): ChatGPT design prompts

Goal: calm, mindful and very professional, the feeling of a good stationery shop or a
quiet career coach's desk. It must feel trustworthy with someone's CV, never "AI startup"
(no purple glow, no sparkles, no robots). It must not look AI-generated or like a template.
Attach the current screenshots (in ~/Downloads/job-refs/: `current-start-desktop.png`,
`current-result-desktop.png`, `current-start-phone.png`) to prompt 1.

Send all prompts in the same chat so the style stays the same.

---

## 1. Four directions on one board

Redesign this CV-tailoring web app (screenshots attached). Keep exactly this content on the
start screen: the top bar ("Job_" with a blinking cursor, a moon icon, "EN"); the title "O CV
à Medida de Cada Vaga"; the short intro; one card that is a 4-step machine with a progress
track (CV, Vaga, Empresa, Rever, "Passo 1 de 4"), the step title "O CV", an upload area with
the button "Carregar o CV", "PDF ou Word. Fica neste dispositivo até ser adaptado.", "ou largar
o ficheiro aqui", the link "Colar Texto", and a "Continuar" button; under the card "Primeiro,
curiosidade? Ver um Exemplo".

Show 4 different directions side by side on one board, each as a desktop screen, A to D:
A. Letterpress studio: warm cotton paper, brass and deep ink, a pressed-type feel, serif titles.
B. Architect's desk: pale blueprint grid, graphite and one ink-blue accent, precise and calm.
C. Library card: cream index cards, a typewriter-tab step track, oxblood stamp accents.
D. Quiet modern: soft stone gradient, generous air, one deep green accent, Swiss typography.

Rules: the card must read as one machine you move through step by step; the CV on the result
screen stays a plain white page (it is the real document, never decorated); no stock 3D, no
people, no robots, no logos or brand names; the background is never one flat colour (paper,
grid or soft gradient).

## 2. The chosen direction, desktop and phone

Make direction [LETTER] as two finished screens: desktop 1536×1024 and phone 1024×1536.
On the phone the card fills the width with a small margin, the step track becomes four short
labels or dots, and nothing is pinned to the bottom edge of the screen.

## 3. The review and the result

Two screens on one board (desktop), same style:
(a) Step 4 "Rever e Adaptar": a summary (CV · 640 palavras; Vaga · Senior QA Automation Engineer;
Vai Receber · Um CV adaptado e uma carta de apresentação), a "71% Compatível" score,
"Já no CV" chips, "Não Está no CV" questions each with a Sim toggle, "Alterações
Sugeridas" with checkboxes, a model choice (Haiku · Mais Rápido, Sonnet · Recomendado, Opus ·
Melhor Escrita) and the button "Adaptar o CV".
(b) The result: tabs CV / Carta de Apresentação, five colour dots (Roxo, Azul, Vermelho,
Verde, Amarelo), "Descarregar PDF" and "Descarregar Word", the CV as a white page, and
beside or under it a "Verificação ATS" panel: eleven ticks and one warning, keyword chips
"No CV" and "Em Falta: Juntar Só Se For Verdade".

## 4. Dark and light

The start screen on the phone twice side by side: light and dark.

## 5. Textures and icons only (no text)

From the chosen design give me ONLY: (a) the page background texture (1536×1024, seamless,
no text, no UI); (b) a card/paper texture (1024×1024, seamless, very subtle); and (c) on a
plain pure #00ff00 green background, these clean line icons spaced apart: upload, paste,
link, company/building, check, warning, download, moon, sun, and an app icon. No letters
anywhere.

---

Tips
- If text appears in 5, reply: "Same image, but remove every letter and word."
- Send me the images and I'll build it: words, steps and features stay from the real app; the
  images give the look (tokens and textures in `job.css`, icons inline SVG).
- Other tools worth trying: Google Stitch (app screens from a prompt, exports to Figma/HTML),
  Figma Make, v0, and Midjourney for paper textures.

# Retake

Application Mac et Windows (Electron) de relecture vidéo. Le relecteur commente à l'image près en
écrivant, en entourant une zone ou en parlant ; l'application produit une archive .zip (rapport
Markdown, JSON et HTML, images annotées, commentaires vocaux WAV) que l'agent Montage vidéo traite avec
le skill `retake`.

## Lancer en développement

    npm install
    npm start

## Ce qui garantit le calage à l'image près

- La cadence et le nombre d'images sont lus dans le conteneur MP4 (table `stts`, `lib/mp4info.js`).
- L'image affichée est suivie avec `requestVideoFrameCallback` ; une pause recale la lecture sur une
  image entière, et l'image enregistrée est celle qui est à l'écran.
- `test/precision.mjs` puis `test/check_frames.py` comparent les images capturées aux images n-2 à n+2
  extraites par ffmpeg.

## Tests

    REVUE_TEST_VIDEO=<rendu.mp4> REVUE_TEST_VIDEO2=<autre.mp4> REVUE_TEST_VOICE=test/fixtures/voix.wav node test/e2e.mjs
    REVUE_TEST_VIDEO=<rendu.mp4> REVUE_TEST_FRAMES=828,1574,1859 node test/precision.mjs && python3 test/check_frames.py

`REVUE_APP_EXECUTABLE` lance les mêmes tests sur l'application empaquetée. Le micro est simulé par
Chromium à partir du WAV de `REVUE_TEST_VOICE` (créé avec `say` sur Mac, voir le skill).

## Installateurs

    npm run dist:mac   # DMG Apple Silicon et Intel, signature ad hoc (pas de certificat Developer ID)
    npm run dist:win   # installateur NSIS x64

Le dépôt public `ncleton/retake` est une copie de ce dossier : son workflow GitHub Actions lance les
tests sur une machine Windows réelle et y fabrique l'installateur Windows natif.

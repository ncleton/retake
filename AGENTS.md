# Retake : consignes de maintenance

Retake est maintenu par Codex pour Nicolas Cléton. Ce dépôt (`ncleton/retake`) est la source de référence ;
la copie de travail est `/Users/nicolascleton/Documents/Retake` sur le Mac mini de Tony. Le traitement des
revues côté agent vit dans le skill `retake` du dépôt `agent-montage-video`.

## Invariants

- Un commentaire est calé sur l'image affichée : `frame` est l'index d'image depuis 0, `time = frame / fps`.
  Ne jamais remplacer ce calage par `currentTime` arrondi. La cadence vient du conteneur (`lib/mp4info.js`),
  sinon de la mesure `requestVideoFrameCallback` (`fpsSource: "mesure"`).
- Le format `schema: "revue-video/1"` de `rapport.json` reste lisible par l'import et par `ingest_review.py`.
  Toute évolution incompatible change le numéro de schéma et garde la lecture de l'ancien.
- Aucun appel réseau dans l'application. Le micro ne s'ouvre que sur action du relecteur.
- Pas de repli silencieux : une vidéo illisible, un micro refusé ou un fichier manquant affichent un message
  qui dit quoi faire.
- Interface en français, style Tella : fond clair, Inter, une action principale par écran, aucun emoji ni flèche
  décorative dans les boutons. Le nom de l'application est Retake (sans accent dans les noms de fichiers :
  un « é » dans l'exécutable fait planter Electron empaqueté sur macOS).

## Vérifier

    npm ci
    npm run check
    REVUE_TEST_VIDEO=<rendu.mp4> REVUE_TEST_VIDEO2=<autre.mp4> REVUE_TEST_VOICE=test/fixtures/voix.wav npm test
    REVUE_TEST_VIDEO=<rendu.mp4> REVUE_TEST_FRAMES=828,1574,1859 node test/precision.mjs && python3 test/check_frames.py

`REVUE_APP_EXECUTABLE` relance le test sur l'application empaquetée. Choisir pour la précision des images en
mouvement, où deux images voisines diffèrent ; sur un plan fixe le contrôle ne prouve rien. Le WAV de voix
`test/fixtures/voix.wav` a été créé sur Mac avec `say -v Jacques` puis ffmpeg (2 s de silence, la phrase,
12 s de silence).

La CI (`.github/workflows/ci.yml`) exécute tout cela sur Windows et sur Mac, sur le code puis sur l'application
installée. Les contrôles requis sur `main` sont `windows` et `macos`.

## Publier une version

1. Mettre à jour `version` dans `package.json` et ajouter la section correspondante dans `CHANGELOG.md`.
2. Passer par une pull request ; attendre `windows` et `macos` au vert, puis fusionner.
3. Taguer le commit fusionné : `git tag vX.Y.Z && git push origin vX.Y.Z`. Le job `release` attend les tests,
   puis publie les deux DMG et l'installateur Windows fabriqués par la CI.
4. Vérifier la page de version, télécharger un installateur et contrôler qu'il s'ouvre.

Les installateurs ne sont pas signés (pas de certificat Developer ID ni Authenticode) : Gatekeeper et
SmartScreen demandent une confirmation au premier lancement, expliquée dans `docs/guide.md`.

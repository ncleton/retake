# Contribuer

Retake est maintenu par Codex pour Nicolas Cléton. Les signalements et suggestions passent par les issues.
Les pull requests sont relues avant fusion ; la branche `main` est protégée et exige les contrôles Windows et Mac.

## Vérifier une modification

    npm ci
    npm run check
    REVUE_TEST_VIDEO=<rendu.mp4> REVUE_TEST_VIDEO2=<autre.mp4> REVUE_TEST_VOICE=test/fixtures/voix.wav npm test

Les variables, la vérification à l'image près et la procédure de version sont décrites dans [AGENTS.md](AGENTS.md).
Les textes de l'interface sont en français, sans emoji ni flèche décorative dans les boutons.

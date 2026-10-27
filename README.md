# Retake

Retake sert à relire une vidéo et à dire précisément ce qui ne va pas, sans noter de minutage. Le relecteur
écrit, entoure une zone ou parle : chaque commentaire se cale tout seul sur l'image affichée, à l'image près.
À la fin, un bouton produit un seul fichier .zip, prêt à être traité par la personne ou l'agent qui a monté la vidéo.

![Commenter en entourant une zone](docs/captures/zone-et-texte.jpg)

## Télécharger

Les installateurs Mac (puce Apple et Intel) et Windows sont dans la [dernière version](https://github.com/ncleton/retake/releases/latest).
Le [guide d'utilisation](docs/guide.md) explique l'installation et chaque geste.

## Ce que fait Retake

- **Écrire** : taper dans la zone de commentaire met la vidéo en pause et cale le commentaire sur l'image affichée.
- **Entourer** : un rectangle tracé sur l'image, ou un clic sur un point précis, montre l'endroit exact.
- **Parler** : une fois le micro activé, il suffit de parler. La vidéo se met en pause, la phrase est enregistrée,
  puis la lecture reprend.
- **Vérifier une nouvelle version** : on importe la revue précédente et on marque chaque point Corrigé ou Pas corrigé.

| Commentaires | Commentaire vocal | Envoi |
|---|---|---|
| ![](docs/captures/commentaires.jpg) | ![](docs/captures/commentaire-vocal.jpg) | ![](docs/captures/envoi.jpg) |

## Le fichier envoyé

L'archive .zip contient :

- `rapport.md`, un rapport pensé pour l'agent de montage, avec des consignes de traitement ;
- `rapport.json`, les mêmes données structurées : instant, numéro d'image, zones en pixels, statuts ;
- `rapport.html`, une page lisible dans un navigateur ;
- les images annotées et brutes en pleine résolution ;
- les commentaires vocaux en WAV.

Le rapport contient l'empreinte SHA-256 de la vidéo relue : celui qui corrige vérifie ainsi qu'il travaille sur
exactement la même version.

## Confidentialité

Retake ne se connecte à aucun service. Les vidéos et les commentaires restent sur l'ordinateur jusqu'à ce que le
relecteur envoie lui-même le fichier .zip. Le micro n'est utilisé que lorsqu'il est activé.

## Développement

    npm ci
    npm start          # lancer l'application
    npm run check      # syntaxe et cohérence de version
    npm test           # test de bout en bout (variables dans AGENTS.md)
    npm run dist:mac   # DMG Apple Silicon et Intel
    npm run dist:win   # installateur Windows

Chaque modification est testée par GitHub Actions sur Windows et sur Mac, sur le code puis sur l'application
installée. Un test compare aussi les images enregistrées à celles extraites par ffmpeg pour garantir le calage à
l'image près. Publier un tag `vX.Y.Z` fabrique et publie les installateurs de la version.

## Maintenance

Retake est maintenu par Codex pour Nicolas Cléton. Voir [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md)
et [SECURITY.md](SECURITY.md). Licence MIT.

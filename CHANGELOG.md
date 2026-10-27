# Journal des versions

Ce projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## 1.0.0

Première version.

- Lecture de vidéos MP4, MOV et WebM avec suivi de l'image affichée et calage des commentaires à l'image près
  (cadence et nombre d'images lus dans le conteneur MP4).
- Trois façons de commenter : écrire (la vidéo se met en pause), entourer une zone ou pointer un endroit sur
  l'image, parler (détection de la parole, pause automatique, reprise de la lecture).
- Liste des commentaires, repères sur la timeline, aperçu au survol, lecture image par image.
- Enregistrement automatique : la revue reprend là où elle s'est arrêtée.
- Envoi en un fichier .zip : rapport Markdown pour l'agent de montage, rapport JSON, page HTML, images
  annotées et brutes en pleine résolution, commentaires vocaux en WAV.
- Vérification d'une nouvelle version : import de la revue précédente, verdict Corrigé ou Pas corrigé par point.
- Installateurs Mac (Apple Silicon et Intel) et Windows, testés de bout en bout sur chaque système.

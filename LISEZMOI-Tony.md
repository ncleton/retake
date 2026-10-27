# Revue : relire une vidéo et dire ce qui ne va pas

Revue est une petite application pour Mac et Windows. Tu regardes la vidéo, et dès que quelque chose
ne va pas tu le dis, tu l'écris ou tu entoures l'endroit sur l'image. Chaque commentaire se cale
tout seul sur l'image affichée : inutile de noter les minutes. À la fin, un bouton crée un seul fichier
à renvoyer.

## Installer

**Mac récent (puce Apple M1, M2, M3, M4…)** : ouvre `Revue-1.0.0-mac-arm64.dmg`.
**Mac plus ancien (processeur Intel)** : ouvre `Revue-1.0.0-mac-x64.dmg`.
En cas de doute : menu Pomme > Informations système > « Puce » (Apple) ou « Processeur » (Intel).

1. Glisse l'icône Revue dans le dossier Applications.
2. Ouvre Revue depuis Applications. Au premier lancement, le Mac affiche « Apple n'a pas pu vérifier
   que Revue ne contient pas de logiciel malveillant » : clique sur Terminé.
3. Ouvre Réglages Système > Confidentialité et sécurité, descends jusqu'au message sur Revue et clique
   sur « Ouvrir quand même », puis confirme. Cette étape n'est à faire qu'une fois.

**Windows** : lance `Revue-1.0.0-windows-x64-installation.exe`. Si Windows affiche « Windows a protégé
votre ordinateur », clique sur « Informations complémentaires » puis « Exécuter quand même ».

Ces avertissements viennent du fait que l'application n'est pas vendue sur une boutique ; ils
n'apparaissent qu'à l'installation.

## Relire une vidéo

1. Ouvre Revue et glisse la vidéo dans la fenêtre (ou clique sur « Choisir une vidéo »).
2. Lance la lecture avec la barre Espace.
3. Quand quelque chose ne va pas, au choix :
   - **parle** : clique une fois sur le micro, à droite de la zone de texte. Ensuite, dès que tu parles,
     la vidéo se met en pause, ta phrase est enregistrée, puis la lecture reprend toute seule.
     Avec des haut-parleurs, mets un casque ou baisse le son de la vidéo pour que l'application
     n'entende pas la voix off ;
   - **écris** : tape directement dans la zone de texte, la vidéo se met en pause, puis Entrée ;
   - **montre** : dessine un rectangle sur l'image avec la souris, ou clique sur un point précis,
     ajoute un mot si tu veux, puis Entrée.
4. Tes commentaires s'affichent à droite. Clique sur l'un d'eux pour revenir à cet endroit.

Les flèches gauche et droite avancent image par image, pratique pour viser le moment exact.
Tout est enregistré au fur et à mesure : tu peux fermer l'application et reprendre plus tard.

## Renvoyer ta revue

Clique sur **Envoyer la revue**, indique ton prénom, puis **Créer le fichier**. Un fichier
« Revue … .zip » est créé dans Documents > Revues vidéo. Envoie ce fichier tel quel (WeTransfer,
e-mail ou message). Le bouton « Copier le message » prépare un petit texte d'accompagnement.

## Vérifier une nouvelle version

Quand tu reçois la version corrigée, ouvre-la dans Revue, puis menu Fichier > Importer la revue
précédente et choisis le fichier `rapport.json` de ta revue précédente (dans Documents > Revues vidéo).
Pour chaque point, clique sur « Corrigé » ou « Pas corrigé », ajoute des commentaires si besoin, et
renvoie la revue de la même façon.

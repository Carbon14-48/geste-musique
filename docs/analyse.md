# Analyse du projet « Geste Musique »

## Contexte
Au départ, le dépôt ne contenait que `catalogue-gestes-geste-musique.pdf`, le document de conception. Le projet consiste à jouer de la musique avec les mains devant une webcam, à partir des 21 points par main détectés dans le navigateur. Le PDF décrit :

- les gestes possibles : poses statiques, mouvements, valeurs continues, gestes à deux mains ;
- les types de déclencheurs ;
- des scénarios par instrument ;
- des conseils de fiabilité et une feuille de route.

Ce document donne un avis sur le projet, propose des ajouts et des améliorations, et explique comment, où et avec quelles données entraîner les modèles. La dernière section indique où chaque recommandation a été mise en œuvre.

---

## 1. Mon avis

**Points forts**
- Le document est bien organisé. Il sépare les gestes en quatre catégories (pose, mouvement, valeur continue, deux mains), ce qui correspond à la manière dont on écrira le code.
- La section 6 sur les déclencheurs (entrée, maintien, relâchement, combo, verrou) est la partie la plus utile : c'est elle qui transforme une simple démo en instrument jouable.
- Les conseils de fiabilité sont justes : hystérésis, normalisation par la taille de la main, éviter les gestes trop proches.
- La feuille de route est progressive et réaliste. Les règles géométriques viennent d'abord, le classifieur seulement à la fin.

**Faiblesses et risques**
1. **Le mode binaire à 32 combinaisons est trop optimiste.** Beaucoup de combinaisons sont presque impossibles à faire physiquement : annulaire levé seul, majeur et auriculaire sans l'annulaire, etc. Le détecteur les confondra aussi. Il vaut mieux compter 10 à 12 combinaisons vraiment fiables.
2. **Il y a des conflits entre gestes déjà présents dans le catalogue :**
   - « Main ouverte », « Paume stop » et « 5 doigts = La » : le système ne peut pas les distinguer de façon fiable.
   - « 2 doigts = Ré » et « V = accord majeur » : le document reconnaît lui-même ce problème.
   - « Poing = STOP » et « Poing = palm mute » à la guitare.
   - Il faut une **table des gestes par mode**, en vérifiant qu'il n'y a pas de collision à l'intérieur de chaque mode.
3. **La méthode pour le « dos de la main » est fragile.** Déduire l'orientation de l'ordre des points (pouce à gauche ou à droite) ne marche pas bien. Il vaut mieux utiliser le **vecteur normal de la paume**, c'est-à-dire le produit vectoriel (poignet→index_base) × (poignet→auriculaire_base). Les coordonnées 3D (x, y, z) fournies par le modèle permettent ce calcul.
4. **La profondeur z n'est pas utilisée.** Pour « tape dans l'air » et « pousser vers la caméra », le modèle MediaPipe Hands donne une coordonnée z relative. Elle est plus fiable que la seule taille de la main à l'écran.
5. **Le problème gauche/droite avec la caméra en miroir n'est pas mentionné.** Avec une webcam frontale, la « main droite » renvoyée par le modèle est souvent la main gauche réelle. Il faut le gérer dès le départ.
6. **La latence est sous-estimée.** Le document compte 30 à 50 ms pour la détection. Il faut y ajouter la latence de la caméra (environ 30 à 60 ms), les 3 à 5 images de stabilisation (environ 100 à 160 ms à 30 images/s) et la sortie audio. Pour les percussions, il faut **déclencher sur la vitesse** (le pic de la frappe) et non attendre une pose stable.
7. **Le document ne parle ni du lissage du signal ni des retours visuels pour le musicien.**

---

## 2. Ce qu'on peut ajouter

| Ajout | Pourquoi |
|---|---|
| **Filtre One Euro** sur les points | Lisse les tremblements sans ajouter de latence. C'est indispensable pour les valeurs continues comme le thérémine ou le volume. |
| **Sortie MIDI (Web MIDI API)** | Le projet devient un vrai contrôleur pour Ableton, FL Studio ou GarageBand. C'est l'ajout qui a le plus de valeur. |
| **Moteur audio Tone.js** | Synthés, samplers, effets (reverb, distorsion, wah) et horloge précise pour le tempo et les boucles. |
| **Quantification sur une gamme** | Le thérémine « aimante » les notes vers la gamme choisie (pentatonique, majeure…). Le jeu sonne juste même pour un débutant. |
| **Calibration au démarrage** | On mesure la taille de la main, l'amplitude des mouvements et la lumière de chaque joueur, puis on adapte les seuils. |
| **Retour visuel** | Squelette de la main affiché, nom du geste reconnu, barre de confiance, zones et pads dessinés à l'écran. |
| **Tutoriel / mode entraînement** | Le jeu affiche un geste, le joueur le reproduit et reçoit un score. Cela aide à mémoriser la table des gestes. |
| **Profils de mapping configurables (JSON)** | L'utilisateur choisit quel geste correspond à quelle action, sans toucher au code. |
| **Enregistrement et export** | Export en WAV, MIDI ou MP3 du morceau joué, et partage de boucles. |
| **Mode accessibilité** | Une seule main, gestes simplifiés, seuils plus tolérants. Utile pour les personnes à mobilité réduite ou en musicothérapie. |
| **Classe « rien / geste parasite »** | Réduit fortement les faux déclenchements. |

---

## 3. Ce qu'on peut améliorer dans la conception
- **Architecture en couches :** `caméra → détecteur (TF.js) → lissage → extraction de caractéristiques (normalisées) → reconnaisseur (règles ou modèle) → machine à états des déclencheurs → mapping → moteur audio/MIDI`. Chaque couche doit pouvoir être testée séparément.
- **Machine à états par geste** (inactif → candidat → actif → relâché), avec hystérésis et durée minimale. Cela remplace les `if` dispersés dans le code.
- **Normalisation complète :** translation (poignet à l'origine), échelle (taille de la main), rotation (axe poignet→majeur aligné) et miroir (main gauche ramenée en main droite).
- **Lancer la détection dans un Web Worker** avec le backend WebGL ou WebGPU, pour que l'audio ne saute pas.
- **Métriques :** mesurer le nombre de faux déclenchements par minute, la latence de bout en bout et la précision par geste. Sans métriques, on ne peut pas savoir si une modification améliore vraiment le jeu.

---

## 4. Faut-il entraîner un modèle ? Oui, mais seulement pour une partie des gestes
- **Les règles géométriques suffisent** pour le comptage des doigts, le poing, les valeurs continues et les zones d'écran.
- **Un modèle entraîné apporte un vrai gain** pour :
  - les poses ambiguës (V/2 doigts, OK, pistolet, griffe, dos de la main) ;
  - les gestes dynamiques (cercle, vague, pianoter, frappe) ;
  - les gestes personnalisés de chaque utilisateur.
- On n'entraîne **jamais** le détecteur de mains lui-même. On garde MediaPipe Hand Landmarker (`@mediapipe/tasks-vision` dans le navigateur, `mediapipe` en Python) et on entraîne seulement un **petit classifieur sur les 21 points**.

### Modèle A : poses statiques
- **Entrée :** 21 points × 3 (x, y, z) normalisés, soit 63 valeurs. On peut ajouter les angles des articulations et les distances entre les bouts des doigts.
- **Modèle :** un MLP (63 → 128 → 64 → N classes), avec dropout. Il fait environ 20 000 paramètres, et l'inférence prend moins de 1 ms.

### Modèle B : gestes dynamiques
- **Entrée :** une fenêtre glissante de 15 à 30 images × 63 valeurs, plus les vitesses.
- **Modèle :** un petit 1D-CNN ou un GRU (ou un mini-Transformer). Il doit rester sous 100 000 paramètres pour tourner en temps réel dans le navigateur.

### Personnalisation directement dans le navigateur
- Un **KNN sur les points normalisés** (`src/ml/knn.js`, onglet *Apprendre*).
- L'utilisateur enregistre 20 à 50 exemples par geste, et l'entraînement se fait en quelques secondes, sans serveur.

---

## 5. Où entraîner
| Option | Usage |
|---|---|
| **Google Colab** (GPU gratuit) | Choix recommandé pour l'extraction des points sur les grands jeux de données et l'entraînement du modèle dynamique. |
| **Kaggle Notebooks** (environ 30 h de GPU par semaine) | Pratique parce que plusieurs jeux de données sont déjà hébergés sur Kaggle. |
| **PC local (CPU)** | Largement suffisant pour le MLP de poses : quelques secondes à quelques minutes. |
| **Navigateur (TF.js)** | Pour la personnalisation par utilisateur. |

**Pipeline :**

1. Python + TensorFlow/Keras 2 (`tf_keras`).
2. Export direct au format TF.js par `training/common.py:export_tfjs`, sans le paquet `tensorflowjs`, dont les dépendances cassent souvent.
3. Chargement avec `tf.loadLayersModel()` dans l'application.

---

## 6. Quels jeux de données

### Poses statiques
- **HaGRID / HaGRIDv2** (HAnd Gesture Recognition Image Dataset)
  - Plus de 500 000 images en v1 et environ 1 million en v2, avec 18 à 33 classes et une classe `no_gesture`.
  - Ses classes correspondent presque une à une au catalogue : `fist` (poing), `like`/`dislike` (pouce levé/baissé), `rock`, `call` (appel), `ok`, `palm`, `stop`, `peace` (V), `one`, `two_up`, `three`, `four`, `mute`…
  - C'est **le meilleur choix**. Les annotations contiennent aussi des points de la main.
- **Kaggle « Google – Isolated Sign Language Recognition »** : des points MediaPipe déjà extraits (fichiers parquet). Utile pour le pré-entraînement et pour les formes de main variées.
- **ASL Alphabet (Kaggle)** : des images de formes de main statiques, utiles comme données supplémentaires.

### Gestes dynamiques
- **Jester (20BN / Qualcomm)**
  - Environ 148 000 vidéos et 27 classes : balayages gauche, droite, haut et bas, zoom, rouler la main, tambouriner des doigts, pouce levé ou baissé…
  - Il correspond très bien à la section « Mouvements » du catalogue.
- **IPN Hand** : 13 gestes dynamiques pensés pour les interfaces sans contact.
- **SHREC'17 / DHG-14/28** : des gestes dynamiques déjà fournis sous forme de squelette de main (22 articulations). Parfait pour un modèle basé sur les points.
- **EgoGesture** (83 classes) et **NVGesture** (25 classes) sont des alternatives.

### Règle importante : même extracteur à l'entraînement et en production
Il faut repasser toutes les images et vidéos dans **le même modèle MediaPipe Hands que celui utilisé dans l'application**. Ensuite, on entraîne sur ces points, et non sur les annotations d'origine. Sinon les données d'entraînement et celles de l'application ne se ressemblent pas, et la précision chute.

### Données propres au projet (indispensables)
- Enregistrer 50 à 100 exemples par geste, avec 5 à 10 personnes différentes, plusieurs éclairages et des distances de 40 à 80 cm.
- Ajouter une **classe « rien »** : mains au repos, transitions entre gestes, mains qui se grattent la tête…
- On pré-entraîne sur HaGRID ou Jester, puis on **affine (fine-tuning) sur ces données maison**.

### Augmentation des données (sur les points)
- Rotation de ±20° et changement d'échelle de ±15 %.
- Miroir gauche/droite et bruit gaussien sur les coordonnées.
- Suppression aléatoire d'un doigt, pour simuler une occlusion.
- Pour les gestes dynamiques : variation de vitesse (time-warp).

### Évaluation
- Garder des personnes séparées entre entraînement et test : les joueurs du test ne doivent jamais apparaître à l'entraînement.
- Regarder la matrice de confusion, en particulier V/2 doigts et main ouverte/paume stop.
- Mesurer les faux déclenchements par minute en jeu réel.

---

## 7. Feuille de route révisée
1. **Prototype jouable :** squelette TF.js, filtre One Euro, règles (poing, 1 à 5 doigts, pince, hauteur), Tone.js et retour visuel.
2. **Machine à états des déclencheurs,** table des gestes par mode sans collisions, calibration et sortie MIDI.
3. **Instruments :** clavier virtuel, pads de batterie déclenchés par la vitesse, grattage de guitare, thérémine quantifié sur une gamme.
4. **Modèle A** (MLP poses, HaGRID + données maison), puis **personnalisation KNN dans le navigateur.**
5. **Modèle B** (gestes dynamiques, Jester/IPN + données maison), boucles et enregistrement.

## Ce qui a été réalisé à partir de cette analyse

| Recommandation | Où dans le code |
|---|---|
| Table des gestes par mode sans collision, pouce seul réservé au volume | `src/modes/*.js`, `overrides` dans `src/modes/global.js` |
| Mode binaire limité à 12 combinaisons fiables | `RELIABLE_COMBOS` dans `src/core/rules.js` |
| Orientation de la paume par produit vectoriel | `palmFacingCamera` dans `src/core/rules.js` |
| Gestion du miroir de la webcam et inversion gauche/droite | `HandTracker.roleFromLabel` dans `src/core/handTracker.js` |
| Percussions déclenchées sur le pic de vitesse | `StrikeDetector` dans `src/core/motion.js` |
| Filtre One Euro | `src/core/oneEuro.js` |
| Machine à états, hystérésis, maintien, double geste, combos | `src/core/trigger.js` |
| Sortie MIDI, export .mid et audio | `src/audio/midi.js`, `src/audio/midiFile.js`, `src/audio/engine.js` |
| Notes aimantées sur une gamme, calibration, retour visuel | `src/core/scale.js`, `src/main.js`, `src/ui/overlay.js` |
| Classifieur de poses (MLP) et classifieur de mouvements (1D-CNN / GRU) | `training/train_pose.py`, `training/train_dynamic.py` |
| Même extracteur à l'entraînement et en production | `training/common.py` et `src/core/detector.js` utilisent `hand_landmarker.task` |
| Normalisation identique en JS et en Python, vérifiée par des tests | `shared/normalize_fixture.json`, `tests/landmarks.test.js`, `training/test_common.py` |
| Gestes personnalisés dans le navigateur | `src/ml/knn.js`, onglet *Apprendre* |

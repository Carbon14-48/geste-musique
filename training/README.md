# Entraînement des modèles TensorFlow

On n'entraîne **jamais** le détecteur de mains : MediaPipe Hand Landmarker s'en charge très bien.
On entraîne de **petits réseaux** sur les 21 points qu'il fournit.

## HandNet : le réseau principal (remplace les règles géométriques)

Un seul réseau décide toute la forme de la main. Sans lui, l'application retombe sur les règles de `src/core/rules.js`.

| | |
|---|---|
| Entrée | 42 valeurs : `handFeatures2d` = 21 points image (x, y), poignet à l'origine, divisés par la taille de la main, miroir pour la main gauche |
| Tronc | Dense 128 ReLU → Dropout 0,3 → Dense 64 ReLU → Dropout 0,2 |
| Sortie `pose` | softmax : poing, 1–4 doigts, V, main ouverte, pouce levé/baissé, cornes, appel, pistolet, OK, autre |
| Sortie `fingers` | 5 sigmoïdes : chaque doigt levé ? (le comptage = leur somme) |
| Sortie `palm` | sigmoïde : paume vers la caméra ? (apprise sur vos enregistrements) |
| Sortie `down` | sigmoïde : doigts vers le bas ? |
| Taille | ≈ 15 000 paramètres, < 100 Ko |
| Fichiers | `public/models/hand/` (chargé tout seul par l'application) |

### Données : HaGRIDv2, sans télécharger d'images
Les annotations de [HaGRIDv2](https://github.com/hukenovs/hagrid) contiennent déjà les 21 points MediaPipe de chaque main
(≈ 1 million de mains, séparées en train / val / test **par personne**). Une archive de 700 Mo, publique :

```bash
cd training
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt   # ou python3.12 -m venv
curl -LO https://rndml-team-cv.obs.ru-moscow-1.hc.sbercloud.ru/datasets/hagrid_v2/annotations_with_landmarks/annotations.zip
unzip annotations.zip -d data/hagrid_v2
.venv/bin/python extract_hagrid_v2.py --annotations data/hagrid_v2/annotations --out data/hagrid_v2.npz   # ≈ 1 min
.venv/bin/python train_hand.py --npz data/hagrid_v2.npz                                                     # ≈ 5–10 min sur CPU
```

Correspondance des classes (`common.HAGRID_V2_MAP`) **vérifiée sur les données** : pour chaque classe on a mesuré
quels doigts sont levés. Par exemple `stop` a le pouce replié (01111) : ce sont nos « 4 doigts », pas la main ouverte ;
`three2` et `three_gun` sont pouce + index + majeur. Les classes `*_inverted` donnent la cible « doigts vers le bas ».
`middle_finger`, `grip`, `point`, `no_gesture`… servent d'exemples « autre » (aucun accord).

Une étiquette inconnue (paume/dos dans HaGRID, doigts d'une pose « autre ») a un **poids nul** : cette sortie
n'apprend simplement pas sur cet exemple. `labels.json` liste les sorties réellement apprises (`trained_heads`) ;
l'application garde la mesure géométrique pour les autres.

### Affinage sur vos mains
- **Dans la page** (bouton *apprendre mes gestes*) : on choisit paume/dos et doigts en haut/en bas, on montre chaque
  geste 3 s, puis TensorFlow.js affine le réseau HaGRID (tronc gelé, puis tout le réseau avec un petit pas).
  Une pose absente de HaGRID (cornes + pouce) ajoute une sortie sans effacer les autres. Sauvegardé dans le navigateur.
- **En Python** : bouton *exporter* → `mes_gestes.json`, puis `train_hand.py --npz data/hagrid_v2.npz --finetune-json mes_gestes.json`.

### Résultats
`train_hand.py` affiche le rapport par classe, la matrice de confusion, la précision par doigt, le comptage exact
et la précision « doigts vers le bas », sur la validation **et** sur le test HaGRID (personnes jamais vues).
Tout est enregistré dans `public/models/hand/metrics.json`.

## Anciens modèles (optionnels)

| Modèle | Entrée | Architecture | Taille | Sortie |
|---|---|---|---|---|
| **A — poses statiques** (remplacé par HandNet) | 63 valeurs (`normalizePose`) | MLP 63 → 128 → 64 → N | ≈ 17 k paramètres | `public/models/pose/` |
| **B — gestes dynamiques** | 24 images × 67 valeurs (`sequenceFeatures`) | 1D-CNN (ou GRU) | ≈ 45 k paramètres | `public/models/dynamic/` |

Sans le modèle B, l'application utilise les détecteurs de mouvement (`src/core/motion.js`).

## Où entraîner ?

| Option | Quand l'utiliser |
|---|---|
| **Google Colab** (GPU T4 gratuit) — `geste_musique_colab.ipynb` | Recommandé : extraction des points HaGRID/Jester et entraînement |
| **Kaggle Notebooks** (≈ 30 h de GPU par semaine) | Pratique : HaGRID est déjà hébergé sur Kaggle |
| **PC local, CPU** | Suffit largement pour le modèle A (quelques minutes) |
| **Navigateur** (onglet *Apprendre*) | Gestes personnels instantanés (k plus proches voisins), sans Python |

## Installation locale

TensorFlow demande **Python 3.10 à 3.12**.

```bash
cd training
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q test_common.py   # vérifie que la normalisation = celle du navigateur
```

## Jeux de données

### Poses statiques
- **HaGRID / HaGRIDv2** — https://github.com/hukenovs/hagrid. Plus de 550 000 images (v1) et environ 1 million (v2), 18 à 33 gestes plus `no_gesture`.
  Ses classes recoupent directement le catalogue (`common.HAGRID_MAP`) :

  | HaGRID | Geste Musique |
  |---|---|
  | `fist` | `fist` |
  | `like`, `dislike` | `like`, `dislike` |
  | `rock`, `call`, `ok` | `rock`, `call`, `ok` |
  | `palm`, `stop` | `palm` |
  | `peace` | `peace` |
  | `one`, `two_up`, `three`, `four` | `one`, `two`, `three`, `four` |
  | `thumb_index` (v2) | `gun` |
  | `no_gesture` | `none` |

  Pour commencer, prenez l'échantillon Kaggle `innominate817/hagrid-sample-30k-384p` (30 000 images, environ 2 Go).
- **Vos données** : onglet *Données* de l'application, puis *Exporter le JSON*. C'est la seule source pour `open`, `claw` et vos gestes personnalisés.

### Gestes dynamiques
- **Jester** (20BN, aujourd'hui chez Qualcomm) : 148 000 vidéos, 27 classes. La table `JESTER_MAP` récupère les balayages, secouer, tourner la main, tambouriner des doigts, pousser, tirer et zoomer.
- **IPN Hand** : 13 gestes pour interfaces sans contact. Utilisez la disposition « un dossier par classe ».
- **SHREC'17 / DHG-14/28** : gestes déjà sous forme de squelette. Il faut un petit adaptateur, car ils ont 22 articulations.
- **Vos séquences** : onglet *Données* → *Séquence (1,5 s)*.

## Règle la plus importante

> Toutes les images passent par **le même `hand_landmarker.task`** que l'application.

On n'utilise jamais les points fournis par un jeu de données. Sinon les données d'entraînement ne
ressemblent pas à celles du jeu, et la précision chute. `common.normalize_pose` et `common.sequence_features`
reproduisent exactement le code JavaScript. Le test `test_common.py` le vérifie avec
`shared/normalize_fixture.json`, un fichier généré par le code JS (`node scripts/make-fixture.mjs`).

## Pipeline

```bash
# 1. Extraire les points (MediaPipe)
python extract_hagrid.py --images data/hagrid_30k --annotations data/ann_train_val \
    --out data/hagrid_landmarks.npz --max-per-class 2000
python extract_videos.py jester --frames data/jester/20bn-jester-v1 --csv data/jester/jester-v1-train.csv \
    --out data/jester.npz --max-per-class 1500

# 2. Entraîner + exporter en TF.js (directement dans public/models/)
python train_pose.py --npz data/hagrid_landmarks.npz --finetune-json data/mes_donnees.json
python train_dynamic.py --npz data/jester.npz --json data/mes_donnees.json

# 3. Relancer l'application (npm run dev) : Réglages → Modèles affiche les classes chargées.
```

Pour tester la chaîne complète sans rien télécharger :

```bash
node ../scripts/make-demo-dataset.mjs data/demo_dataset.json   # données synthétiques
python train_pose.py --json data/demo_dataset.json --epochs 30 --out output/pose_demo
python train_dynamic.py --json data/demo_dataset.json --epochs 30 --out output/dynamic_demo
```

## Augmentation des données (dans `common.py`)
- **Poses :**
  - rotation de ±20° dans le plan de l'image et de ±10° en profondeur ;
  - échelle ±15 % et bruit gaussien ;
  - « doigt fantôme » : bruit fort sur un doigt, pour simuler une occlusion.
- **Séquences :**
  - variation de vitesse (*time-warp*) et rotation commune ;
  - images perdues (main non détectée).

## Évaluation
- La validation se fait **par personne** (`subject_split`) : une personne vue à l'entraînement n'apparaît jamais en validation.
- Le script affiche le rapport par classe, la matrice de confusion et les paires confondues à plus de 3 %, comme `two`/`peace` ou `palm`/`open`.
- Objectifs :
  - au moins 95 % de précision sur des personnes jamais vues ;
  - moins d'un faux déclenchement par minute en jeu réel.

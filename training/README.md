# Entraînement des modèles TensorFlow

On n'entraîne **jamais** le détecteur de mains : MediaPipe Hand Landmarker s'en charge très bien.
On entraîne seulement deux **petits classifieurs** sur les 21 points qu'il fournit :

| Modèle | Entrée | Architecture | Taille | Sortie |
|---|---|---|---|---|
| **A — poses statiques** | 63 valeurs (`normalizePose`) | MLP 63 → 128 → 64 → N | ≈ 17 k paramètres | `public/models/pose/` |
| **B — gestes dynamiques** | 24 images × 67 valeurs (`sequenceFeatures`) | 1D-CNN (ou GRU) | ≈ 45 k paramètres | `public/models/dynamic/` |

Les deux modèles sont **optionnels**. Sans eux, l'application utilise les règles géométriques
(`src/core/rules.js`) et les détecteurs de mouvement (`src/core/motion.js`). Quand un modèle est présent,
il remplace les règles dès que sa confiance dépasse 80 %.

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

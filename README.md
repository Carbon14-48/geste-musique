# 🖐 Geste Musique

**Jouer de la musique avec les mains devant une webcam.** Le projet tourne entièrement dans le navigateur :
MediaPipe repère les 21 points de chaque main, des règles géométriques ou des modèles TensorFlow.js
reconnaissent les gestes, et Tone.js produit le son. Le projet peut aussi piloter un logiciel de musique en MIDI.

Le projet suit le cahier des charges [`docs/catalogue-gestes-geste-musique.pdf`](docs/catalogue-gestes-geste-musique.pdf).
L'analyse et les choix techniques sont dans [`docs/analyse.md`](docs/analyse.md).

## Deux instruments

| Page | Contenu |
|---|---|
| **Geste Live** (`index.html`, page d'accueil) | Instrument à deux mains, dans l'esprit de [gesture.live](https://gesture.live). La main gauche joue les accords, la main droite choisit dans un arc l'un des 5 modes : batterie, basse, mélodie, fx, sculpt. |
| **Studio** (`studio.html`) | Les 8 modes du catalogue, l'apprentissage de gestes et la collecte de données pour TensorFlow |

### Geste Live en bref
- **Main gauche (accords)** :
  - 1 à 4 doigts = accords I à IV, main ouverte = V, cornes = VI, cornes + pouce = VII ;
  - dos de la main = mode parallèle ; doigts vers le bas = un demi-ton plus bas ;
  - hauteur de la main = triade, puis 7e, 9e et 13e ;
  - rotation du poignet = filtre.
- **Main droite** :
  - poing dos à la caméra → l'arc des modes apparaît ; on glisse, puis on ouvre la main pour choisir ;
  - pincer le pouce avec un doigt choisit une piste, et la rotation du poignet règle sa valeur.
- **Enregistrement** d'une prise vidéo + son, en format large ou vertical 720×1280, entièrement dans le navigateur.
- **Clavier** : <kbd>1</kbd>–<kbd>5</kbd> mode, <kbd>R</kbd> enregistrer, <kbd>Espace</kbd> silence.

## Démarrage rapide

```bash
npm install        # installe les dépendances, copie MediaPipe et télécharge le modèle de mains
npm run dev        # ouvre http://localhost:5173
```

Cliquez ensuite sur **Démarrer**, autorisez la caméra et montrez vos mains.
Placez-vous à 50–80 cm de la caméra, bien éclairé de face.

Autres commandes :

```bash
npm test           # 72 tests unitaires (théorie musicale, arc, pincements, règles, modes…)
npm run build      # version statique dans dist/ (GitHub Pages, Netlify…)
```

> La caméra n'est accessible qu'en **HTTPS** ou sur **localhost**.

## Studio : les 8 modes

| Mode | Principe |
|---|---|
| **1. Notes** (version de base) | Main droite : 1 à 5 doigts = Do Ré Mi Sol La, poing = STOP, hauteur = octave, inclinaison = vibrato. Main gauche tenue = instrument. |
| **2. Binaire** | 12 combinaisons de doigts fiables = 12 notes sur deux octaves. |
| **3. Thérémine** | Hauteur de la main droite = note continue (option « aimanter » sur la gamme), main gauche = volume. |
| **4. Piano** | Clavier de 8 touches dans l'air : l'index vise une touche, une tape vers le bas la joue, V = accord. |
| **5. Batterie** | 4 pads : la frappe joue le pad visé et sa vitesse donne la force. Secouer = shaker, applaudir = clap. |
| **6. Guitare** | Main gauche = accord (Do, Sol, La m, Fa, Mi m), main droite = grattage vers le bas ou le haut. |
| **7. DJ et boucles** | Séquenceur 16 pas : pouce levé = lecture, balayage = motif, hauteur des mains = filtre et réverbération. |
| **8. Mes gestes** | Gestes appris dans l'onglet *Apprendre* (k plus proches voisins, dans le navigateur). |

**Gestes valables partout :**
- OK tenu 1 s : verrouiller ou déverrouiller le jeu ;
- deux poings : silence total ;
- pouce levé / baissé : volume ;
- rock : distorsion ;
- appel (pouce + auriculaire) : effet wah ;
- pistolet : enregistrer une couche de boucle (deux fois = annuler) ;
- balayage de la main gauche : changer d'instrument ;
- poing → main ouverte → 2 doigts : riff.

**Clavier :** <kbd>1</kbd>–<kbd>8</kbd> pour changer de mode, <kbd>Espace</kbd> pour le silence,
<kbd>V</kbd> pour le verrou, <kbd>B</kbd> pour la boucle.

## Fonctionnalités
- **Fiabilité** :
  - filtre One Euro ;
  - stabilisation sur plusieurs images avec hystérésis ;
  - distances normalisées par la taille de la main ;
  - calibration (main ouverte, poing, main en bas, main en haut) ;
  - seuils réglables.
- **Déclencheurs** : entrée, maintien, relâchement, double geste, combo, zones, seuil de vitesse, verrou.
- **Sorties** :
  - son avec Tone.js : 5 instruments, batterie, thérémine ;
  - effets : distorsion, wah, filtre, réverbération, vibrato ;
  - **MIDI** (Web MIDI) vers Ableton, FL Studio, GarageBand… ;
  - export **audio** (WebM) et **.mid**.
- **Looper** : enregistrement et superposition de boucles.
- **Apprentissage** :
  - gestes personnels dans le navigateur ;
  - collecte de données (poses et séquences) exportée en JSON pour l'entraînement Python.

## Architecture

```
caméra ─► MediaPipe Hand Landmarker (src/core/detector.js)
       ─► lissage One Euro + rôles gauche/droite (src/core/handTracker.js)
       ─► poses : règles (src/core/rules.js) ou modèle TF.js A (src/ml/models.js)
       ─► mouvements : détecteurs (src/core/motion.js) ou modèle TF.js B
       ─► déclencheurs stables (src/core/trigger.js)
       ─► gestes globaux (src/modes/global.js) ─► mode courant (src/modes/*.js)
       ─► moteur audio Tone.js + MIDI + looper (src/audio/*)
```

| Dossier | Contenu |
|---|---|
| `src/live/` | Geste Live : théorie (accords, épices), main gauche, arc, pincements, 5 modes, audio, planche, enregistrement |
| `src/core/` | Points de la main, normalisation, règles, filtres, mouvements, déclencheurs, gammes |
| `src/audio/` | Moteur Tone.js, sortie MIDI, fichier .mid, looper |
| `src/modes/` | Un fichier par mode, plus les gestes globaux |
| `src/ml/` | Chargement des modèles TF.js, KNN, enregistrement de données |
| `training/` | Extraction (HaGRID, Jester…) et entraînement TensorFlow, notebook Colab |
| `shared/` | Fichier de référence qui garantit la même normalisation en JS et en Python |
| `tests/` | Tests Vitest |

## Entraîner les modèles TensorFlow

Tout est décrit dans [`training/README.md`](training/README.md), en résumé :

1. **Données** :
   - [HaGRID](https://github.com/hukenovs/hagrid) pour les poses ;
   - Jester ou IPN Hand pour les mouvements ;
   - surtout **vos propres données**, enregistrées dans l'onglet *Données* de l'application.
2. **Où** : [Google Colab](training/geste_musique_colab.ipynb) (GPU gratuit) ou un PC (CPU suffisant pour les poses).
3. **Comment** :

   ```bash
   cd training && pip install -r requirements.txt     # Python 3.10–3.12
   python extract_hagrid.py --images … --annotations … --out data/hagrid.npz
   python train_pose.py --npz data/hagrid.npz --finetune-json data/mes_donnees.json
   ```

4. Les modèles sont écrits dans `public/models/pose/` et `public/models/dynamic/`. L'application les charge toute seule au démarrage.

## Limites connues
- Si une main est de profil ou si des doigts sont cachés, le comptage se trompe. Quand les mains se croisent, la gauche et la droite peuvent s'inverser. L'option *Inverser main gauche / droite* est dans les Réglages.
- La latence totale (caméra, détection, stabilisation) est de 100 à 150 ms. Les percussions se déclenchent donc sur le pic de vitesse, sans attendre une pose stable.
- Le MIDI demande Chrome ou Edge. Firefox et Safari ne le gèrent que partiellement.

# Modèles servis à l'application

| Fichier / dossier | Origine | Obligatoire |
|---|---|---|
| `hand_landmarker.task` | téléchargé par `npm install` (`scripts/setup.mjs`) | non : sinon l'URL Google est utilisée |
| `pose/` (`model.json`, `*.bin`, `labels.json`) | `training/train_pose.py` | non : sinon règles géométriques |
| `dynamic/` (`model.json`, `*.bin`, `labels.json`) | `training/train_dynamic.py` | non : sinon détecteurs de mouvement à règles |

L'onglet **Réglages → Modèles** de l'application indique ce qui a été chargé.

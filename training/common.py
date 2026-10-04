"""Fonctions partagées par les scripts d'entraînement.

La normalisation DOIT rester identique à src/core/landmarks.js (normalizePose, frameFeatures).
test_common.py le vérifie avec shared/normalize_fixture.json, généré par le code JavaScript.
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WEB_MODELS = ROOT / "public" / "models"
POSE_DIM = 63
FRAME_DIM = 67
SEQ_STEPS = 24

WRIST, THUMB_TIP, INDEX_MCP, MIDDLE_MCP = 0, 4, 5, 9
FINGER_CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]

HAND_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)

# Étiquettes HaGRID (v1 et v2) -> étiquettes de Geste Musique (src/core/rules.js, POSE_LABELS).
HAGRID_MAP = {
    "fist": "fist",
    "one": "one",
    "two_up": "two",
    "two_up_inverted": "two",
    "peace": "peace",
    "peace_inverted": "peace",
    "three": "three",
    "three2": "three",
    "four": "four",
    "palm": "palm",
    "stop": "palm",
    "stop_inverted": "palm",
    "like": "like",
    "dislike": "dislike",
    "rock": "rock",
    "call": "call",
    "ok": "ok",
    "thumb_index": "gun",
    "thumb_index2": "gun",
    "no_gesture": "none",
}

# Classes Jester -> mouvements de Geste Musique.
JESTER_MAP = {
    "Swiping Left": "swipe_left",
    "Swiping Right": "swipe_right",
    "Swiping Up": "swipe_up",
    "Swiping Down": "swipe_down",
    "Shaking Hand": "shake",
    "Turning Hand Clockwise": "circle",
    "Turning Hand Counterclockwise": "circle",
    "Drumming Fingers": "drum_fingers",
    "Zooming In With Full Hand": "pulse",
    "Pushing Hand Away": "push",
    "Pulling Hand In": "pull",
    "No gesture": "none",
    "Doing other things": "none",
}


# --------------------------------------------------------------------------------------------
# Normalisation (miroir exact de src/core/landmarks.js)
# --------------------------------------------------------------------------------------------

def normalize_pose(world: np.ndarray, handedness: str) -> np.ndarray:
    """world : (21, 3) points monde. Renvoie (63,) : poignet à l'origine, divisé par
    |poignet -> base du majeur|, x inversé pour une main « Left »."""
    world = np.asarray(world, dtype=np.float64)
    rel = world - world[WRIST]
    s = float(np.linalg.norm(world[MIDDLE_MCP] - world[WRIST]))
    if s < 1e-6:
        s = 1.0
    rel = rel / s
    if handedness == "Left":
        rel[:, 0] = -rel[:, 0]
    return rel.reshape(-1)


def _ref(hand: dict | None):
    if hand is None:
        return None
    img = np.asarray(hand["image"], dtype=np.float64)
    return {
        "x": img[WRIST, 0],
        "y": img[WRIST, 1],
        "size": float(np.hypot(*(img[WRIST, :2] - img[MIDDLE_MCP, :2]))),
    }


def frame_features(hand: dict | None, ref: dict | None) -> np.ndarray:
    """(67,) : 63 de pose + dx, dy du poignet (en tailles de main) + log(échelle) + présence."""
    if hand is None or ref is None:
        return np.zeros(FRAME_DIM)
    pose = normalize_pose(hand["world"], hand["handedness"])
    img = np.asarray(hand["image"], dtype=np.float64)
    size = max(float(np.hypot(*(img[WRIST, :2] - img[MIDDLE_MCP, :2]))), 1e-6)
    ref_size = max(ref["size"], 1e-6)
    extra = [
        (img[WRIST, 0] - ref["x"]) / ref_size,
        (img[WRIST, 1] - ref["y"]) / ref_size,
        np.log(size / ref_size),
        1.0,
    ]
    return np.concatenate([pose, extra])


def sequence_features(hands: list[dict | None]) -> np.ndarray:
    """(T, 67) à partir d'une liste de mains (ou None quand la main n'est pas détectée)."""
    first = next((h for h in hands if h is not None), None)
    ref = _ref(first)
    return np.stack([frame_features(h, ref) for h in hands])


def resample_uniform(items: list, n: int = SEQ_STEPS) -> list:
    """Garde exactement n éléments régulièrement espacés (plus proche voisin)."""
    if not items:
        return [None] * n
    idx = np.round(np.linspace(0, len(items) - 1, n)).astype(int)
    return [items[i] for i in idx]


def resample_by_time(frames: list[dict], n: int = SEQ_STEPS) -> list:
    """Équivalent de resampleByTime (JS) pour des images horodatées {t, hand}."""
    if not frames:
        return [None] * n
    t0, t1 = frames[0]["t"], frames[-1]["t"]
    out, j = [], 0
    for i in range(n):
        t = t1 if n == 1 else t0 + (t1 - t0) * i / (n - 1)
        while j < len(frames) - 1 and abs(frames[j + 1]["t"] - t) <= abs(frames[j]["t"] - t):
            j += 1
        out.append(frames[j]["hand"])
    return out


# --------------------------------------------------------------------------------------------
# Augmentation (sur les points bruts, avant normalisation)
# --------------------------------------------------------------------------------------------

def augment_world(world: np.ndarray, rng: np.random.Generator, rot_deg: float = 20, noise: float = 0.03) -> np.ndarray:
    """Rotation dans le plan de l'image, petite rotation en profondeur, bruit, et
    « doigt fantôme » (bruit fort sur un doigt pour simuler une occlusion)."""
    w = np.asarray(world, dtype=np.float64).copy()
    center = w[WRIST].copy()
    w -= center
    size = max(float(np.linalg.norm(w[MIDDLE_MCP])), 1e-6)
    a = np.deg2rad(rng.uniform(-rot_deg, rot_deg))
    b = np.deg2rad(rng.uniform(-rot_deg / 2, rot_deg / 2))
    rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    ry = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    w = w @ (rz @ ry).T
    w *= rng.uniform(0.85, 1.15)
    w += rng.normal(0, noise * size, w.shape)
    if rng.random() < 0.1:
        chain = FINGER_CHAINS[rng.integers(0, 5)]
        w[chain[1:]] += rng.normal(0, 0.15 * size, (len(chain) - 1, 3))
    return w + center


def augment_sequence(hands: list[dict | None], rng: np.random.Generator) -> list[dict | None]:
    """Même rotation pour toute la séquence + variation de vitesse (time-warp) + images perdues."""
    n = len(hands)
    warp = np.clip(np.cumsum(rng.uniform(0.7, 1.3, n)), 0, None)
    warp = (warp - warp[0]) / max(warp[-1] - warp[0], 1e-6) * (n - 1)
    picked = [hands[int(round(i))] for i in warp]
    a = np.deg2rad(rng.uniform(-15, 15))
    rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    out = []
    for h in picked:
        if h is None or rng.random() < 0.05:
            out.append(None)
            continue
        img = np.asarray(h["image"], dtype=np.float64).copy()
        img[:, :2] = (img[:, :2] - 0.5) @ rot.T + 0.5
        world = augment_world(h["world"], rng, rot_deg=8, noise=0.02)
        out.append({"handedness": h["handedness"], "world": world, "image": img})
    return out


# --------------------------------------------------------------------------------------------
# Données exportées depuis l'application (onglet « Données »)
# --------------------------------------------------------------------------------------------

def load_browser_dataset(path: str | os.PathLike) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") != "geste-musique-dataset":
        raise ValueError(f"{path} : format non reconnu")
    return data


# --------------------------------------------------------------------------------------------
# MediaPipe Hand Landmarker (le même modèle que dans le navigateur)
# --------------------------------------------------------------------------------------------

def hand_landmarker_path(cache_dir: str | os.PathLike = ROOT / "training" / "data") -> str:
    local = ROOT / "public" / "models" / "hand_landmarker.task"
    if local.exists():
        return str(local)
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / "hand_landmarker.task"
    if not path.exists():
        print(f"Téléchargement de {HAND_LANDMARKER_URL} …")
        urllib.request.urlretrieve(HAND_LANDMARKER_URL, path)
    return str(path)


def create_landmarker(num_hands: int = 1, min_confidence: float = 0.3):
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=hand_landmarker_path()),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=num_hands,
        min_hand_detection_confidence=min_confidence,
        min_hand_presence_confidence=min_confidence,
    )
    return vision.HandLandmarker.create_from_options(options), mp


def detect_hands(landmarker, mp, rgb: np.ndarray) -> list[dict]:
    """Renvoie [{handedness, score, world (21,3), image (21,3)}] pour une image RGB uint8."""
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    res = landmarker.detect(image)
    hands = []
    for i, lms in enumerate(res.hand_landmarks):
        cat = res.handedness[i][0]
        hands.append({
            "handedness": cat.category_name,
            "score": float(cat.score),
            "image": np.array([[p.x, p.y, p.z] for p in lms]),
            "world": np.array([[p.x, p.y, p.z] for p in res.hand_world_landmarks[i]]),
        })
    return hands


def legacy_keras():
    """Renvoie Keras 2 (paquet tf_keras) : c'est le format de modèle que TF.js sait lire."""
    try:
        import tf_keras
    except ImportError:
        raise SystemExit("Installez tf_keras, de la même version que tensorflow : pip install tf_keras") from None
    return tf_keras


# --------------------------------------------------------------------------------------------
# Export TensorFlow.js
# --------------------------------------------------------------------------------------------

def _tfjs_weight_name(name: str) -> str:
    """« dense/kernel:0 » -> « dense/kernel » ; « gru/gru_cell/kernel:0 » -> « gru/kernel » (noms attendus par TF.js)."""
    name = name.split(":")[0]
    parts = name.split("/")
    if len(parts) == 3 and parts[1].endswith("_cell"):
        parts = [parts[0], parts[2]]
    return "/".join(parts)


def export_tfjs(model, labels: list[str], out_dir: Path, extra: dict | None = None) -> None:
    """Écrit le modèle au format « layers-model » de TensorFlow.js (model.json + poids binaires)
    et labels.json. Pas besoin du paquet Python tensorflowjs, dont les dépendances cassent souvent.
    Le modèle doit être un modèle Keras 2 (tf_keras, voir TF_USE_LEGACY_KERAS dans les scripts)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    weights, specs = [], []
    for w in model.weights:
        value = np.asarray(w.numpy(), dtype="<f4")
        weights.append(value.tobytes())
        specs.append({"name": _tfjs_weight_name(w.name), "shape": list(value.shape), "dtype": "float32"})
    (out_dir / "group1-shard1of1.bin").write_bytes(b"".join(weights))
    model_json = {
        "format": "layers-model",
        "generatedBy": "tf_keras",
        "convertedBy": "geste-musique/training/common.py",
        "modelTopology": json.loads(model.to_json()),
        "weightsManifest": [{"paths": ["group1-shard1of1.bin"], "weights": specs}],
    }
    (out_dir / "model.json").write_text(json.dumps(model_json), encoding="utf-8")
    meta = {"labels": labels, **(extra or {})}
    (out_dir / "labels.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ Modèle TF.js écrit dans {out_dir}")


def subject_split(subjects: np.ndarray, val_fraction: float = 0.2, seed: int = 0):
    """Sépare entraînement / validation PAR PERSONNE : un joueur n'apparaît que d'un côté."""
    uniq = np.unique(subjects)
    rng = np.random.default_rng(seed)
    rng.shuffle(uniq)
    if len(uniq) < 2:
        idx = rng.permutation(len(subjects))
        cut = int(len(idx) * (1 - val_fraction))
        train = np.zeros(len(subjects), bool)
        train[idx[:cut]] = True
        return train, ~train
    n_val = max(1, int(round(len(uniq) * val_fraction)))
    val_subjects = set(uniq[:n_val])
    val = np.array([s in val_subjects for s in subjects])
    return ~val, val

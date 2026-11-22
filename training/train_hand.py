"""Entraîne HandNet : UN réseau à 4 sorties qui remplace les règles géométriques, et l'exporte pour TensorFlow.js.

Entrée : 42 valeurs (handFeatures2d : 21 points image x, y, centrés sur le poignet, mis à l'échelle).
Sorties :
  pose    softmax  quelle pose (poing, 1 doigt, cornes…)
  fingers 5 × sigmoïde  chaque doigt levé ? (donne aussi le comptage)
  palm    sigmoïde  paume vers la caméra ? (appris seulement sur vos enregistrements)
  down    sigmoïde  doigts vers le bas ?

Une étiquette inconnue (ex. paume/dos dans HaGRID) a un poids nul : cette sortie n'apprend pas sur cet exemple.

Exemples :
    python train_hand.py --npz data/hagrid_v2.npz
    python train_hand.py --npz data/hagrid_v2.npz --finetune-json data/mes_gestes.json
    python train_hand.py --json data/mes_gestes.json --epochs 40            # vos données seules

Sortie : public/models/hand/{model.json, *.bin, labels.json, metrics.json}, chargés par l'application.
"""

from __future__ import annotations

import os

# TF.js lit les modèles « Keras 2 » : on force tf.keras -> tf_keras avant d'importer TensorFlow.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np

from common import (
    HAND2D_DIM, HEADS, WEB_MODELS, augment_2d, down_for, export_tfjs, fingers_for, hand_features_2d,
    legacy_keras, load_browser_dataset, subject_split,
)

BROWSER_ASPECT = 720 / 1280  # vidéo 720p si l'export ne précise pas l'aspect


# --------------------------------------------------------------------------------------------
# Données
# --------------------------------------------------------------------------------------------

class Samples:
    """Points bruts + étiquettes de chaque sortie (None = inconnue)."""

    def __init__(self):
        self.image, self.handedness, self.aspect = [], [], []
        self.label, self.fingers, self.palm, self.down = [], [], [], []
        self.subject, self.split = [], []

    def __len__(self):
        return len(self.label)

    def add(self, image, handedness, aspect, label, fingers, palm, down, subject, split):
        self.image.append(np.asarray(image, dtype=np.float32)[:, :2])
        self.handedness.append(handedness)
        self.aspect.append(aspect)
        self.label.append(label)
        self.fingers.append(fingers)
        self.palm.append(palm)
        self.down.append(down)
        self.subject.append(subject)
        self.split.append(split)

    def subset(self, idx):
        out = Samples()
        for k, v in self.__dict__.items():
            setattr(out, k, [v[i] for i in idx])
        return out


def load_hagrid(files: list[Path], out: Samples) -> None:
    for f in files:
        d = np.load(f, allow_pickle=False)
        for img, label, raw, subject, split in zip(d["image"], d["label"], d["raw"], d["subject"], d["split"]):
            raw = str(raw)
            # Main gauche / droite inconnue dans HaGRID : pas de miroir, et retournement aléatoire à l'augmentation.
            out.add(img, "Unknown", 1.0, str(label), fingers_for(str(label), raw), None, down_for(raw),
                    f"hagrid:{subject}", str(split))


def load_browser(files: list[Path], out: Samples) -> None:
    for f in files:
        for p in load_browser_dataset(f)["poses"]:
            label = p["label"]
            palm = p.get("palm")
            down = p.get("down")
            out.add(np.array(p["image"]), p["handedness"], p.get("aspect", BROWSER_ASPECT), label, fingers_for(label),
                    None if palm is None else float(palm), None if down is None else float(down),
                    f"app:{p.get('subject', 'inconnu')}", "")


def featurize(s: Samples, lab_idx: dict, rng=None, copies: int = 0):
    """Caractéristiques + cibles + poids (0 = étiquette inconnue). copies = versions augmentées en plus."""
    X, y_pose, y_f, y_p, y_d, w_f, w_p, w_d = [], [], [], [], [], [], [], []
    for i in range(len(s)):
        unknown_side = s.handedness[i] not in ("Left", "Right")
        for c in range(1 + copies):
            img = s.image[i] if c == 0 else augment_2d(s.image[i], rng)
            x = hand_features_2d(img, s.handedness[i], s.aspect[i])
            if unknown_side and rng is not None and rng.random() < 0.5:
                x = x.copy()
                x[0::2] = -x[0::2]  # main gauche ou droite : le réseau voit les deux
            X.append(x)
            y_pose.append(lab_idx[s.label[i]])
            f = s.fingers[i]
            y_f.append(f if f is not None else np.zeros(5, np.float32))
            w_f.append(0.0 if f is None else 1.0)
            y_p.append(s.palm[i] or 0.0)
            w_p.append(0.0 if s.palm[i] is None else 1.0)
            y_d.append(s.down[i] or 0.0)
            w_d.append(0.0 if s.down[i] is None else 1.0)
    X = np.array(X, dtype=np.float32)
    Y = {"pose": np.array(y_pose), "fingers": np.array(y_f, np.float32),
         "palm": np.array(y_p, np.float32)[:, None], "down": np.array(y_d, np.float32)[:, None]}
    W = {"fingers": np.array(w_f, np.float32), "palm": np.array(w_p, np.float32), "down": np.array(w_d, np.float32)}
    return X, Y, W


# --------------------------------------------------------------------------------------------
# Modèle
# --------------------------------------------------------------------------------------------

def build_model(n_labels: int):
    """Même architecture et mêmes noms de couches que buildHandNet (src/ml/handModel.js)."""
    keras = legacy_keras()
    inp = keras.layers.Input(shape=(HAND2D_DIM,), name="hand_input")
    x = keras.layers.Dense(128, activation="relu", name="dense_a")(inp)
    x = keras.layers.Dropout(0.3)(x)
    x = keras.layers.Dense(64, activation="relu", name="trunk")(x)
    x = keras.layers.Dropout(0.2)(x)
    outputs = [
        keras.layers.Dense(n_labels, activation="softmax", name="pose")(x),
        keras.layers.Dense(5, activation="sigmoid", name="fingers")(x),
        keras.layers.Dense(1, activation="sigmoid", name="palm")(x),
        keras.layers.Dense(1, activation="sigmoid", name="down")(x),
    ]
    return keras.Model(inp, outputs, name="handnet")


def compile_model(model, lr: float):
    keras = legacy_keras()
    model.compile(
        optimizer=keras.optimizers.Adam(lr),
        loss={"pose": "sparse_categorical_crossentropy", "fingers": "binary_crossentropy",
              "palm": "binary_crossentropy", "down": "binary_crossentropy"},
        loss_weights={"pose": 1.0, "fingers": 0.5, "palm": 0.5, "down": 0.5},
        metrics={"pose": "accuracy"},
    )


def fit(model, train, val, epochs: int, pose_weights: np.ndarray | None, batch: int):
    keras = legacy_keras()
    X, Y, W = train
    sw = dict(W)
    sw["pose"] = pose_weights[Y["pose"]] if pose_weights is not None else np.ones(len(X), np.float32)
    Xv, Yv, Wv = val
    swv = dict(Wv, pose=np.ones(len(Xv), np.float32))
    cb = [
        keras.callbacks.EarlyStopping(monitor="val_pose_accuracy", mode="max", patience=6, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3),
    ]
    model.fit(X, Y, sample_weight=sw, validation_data=(Xv, Yv, swv), epochs=epochs, batch_size=batch,
              callbacks=cb, verbose=2)


# --------------------------------------------------------------------------------------------
# Évaluation
# --------------------------------------------------------------------------------------------

def report(model, data, labels: list[str], title: str) -> dict:
    from sklearn.metrics import classification_report, confusion_matrix

    X, Y, W = data
    pose, fingers, palm, down = model.predict(X, verbose=0, batch_size=4096)
    pred = pose.argmax(1)
    yv = Y["pose"]
    present = sorted(set(yv) | set(pred))
    print(f"\n=== {title} : {len(X)} mains ===")
    print(classification_report(yv, pred, labels=present, target_names=[labels[i] for i in present], digits=3,
                                zero_division=0))
    cm = confusion_matrix(yv, pred, labels=present)
    print("Matrice de confusion (lignes = vrai, colonnes = prédit) :")
    print("".join(f"{labels[i][:7]:>8}" for i in present))
    for row, i in zip(cm, present):
        print("".join(f"{v:>8}" for v in row), f"  {labels[i]}")
    pairs = []
    for a, i in enumerate(present):
        total = cm[a].sum()
        for b, j in enumerate(present):
            if a != b and total and cm[a, b] / total > 0.03:
                pairs.append((labels[i], labels[j], round(float(cm[a, b] / total), 3)))
    if pairs:
        print("Confusions > 3 % :", sorted(pairs, key=lambda p: -p[2]))

    out = {"pose_accuracy": float((pred == yv).mean()), "confusions": pairs, "n": int(len(X)),
           "confusion_matrix": {"labels": [labels[i] for i in present], "rows": cm.tolist()}}
    m = W["fingers"] > 0
    if m.any():
        fp = (fingers[m] >= 0.5) == (Y["fingers"][m] >= 0.5)
        out["fingers_accuracy"] = [round(float(v), 4) for v in fp.mean(0)]
        out["count_accuracy"] = float(((fingers[m] >= 0.5).sum(1) == Y["fingers"][m].sum(1)).mean())
        print("Doigts (pouce..auriculaire) :", out["fingers_accuracy"], "· comptage exact :", round(out["count_accuracy"], 4))
    for head, p in (("palm", palm), ("down", down)):
        m = W[head] > 0
        if m.any():
            out[f"{head}_accuracy"] = float(((p[m, 0] >= 0.5) == (Y[head][m, 0] >= 0.5)).mean())
            print(f"{head} :", round(out[f"{head}_accuracy"], 4))
    return out


# --------------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--npz", nargs="*", type=Path, default=[], help="fichiers de extract_hagrid_v2.py")
    ap.add_argument("--json", nargs="*", type=Path, default=[], help="exports de l'application (bouton « exporter »)")
    ap.add_argument("--finetune-json", nargs="*", type=Path, default=[], help="affinage final sur vos données")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--augment", type=int, default=1, help="copies augmentées par exemple d'entraînement")
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--out", type=Path, default=WEB_MODELS / "hand")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    if not (args.npz or args.json):
        ap.error("donnez au moins --npz ou --json")

    rng = np.random.default_rng(args.seed)
    data = Samples()
    load_hagrid(args.npz, data)
    load_browser(args.json, data)
    ft = Samples()
    load_browser(args.finetune_json, ft)

    counts = Counter(data.label) + Counter(ft.label)
    labels = sorted(counts)
    lab_idx = {l: i for i, l in enumerate(labels)}
    print("Poses :", dict(sorted(counts.items())))

    # Parties : celles de HaGRID (déjà séparées par personne), sinon séparation par personne.
    split = np.array(data.split)
    if not (split == "train").any():
        tr, va = subject_split(np.array(data.subject), 0.2, args.seed)
        split = np.where(tr, "train", "val")
    idx = {k: np.where(split == k)[0] for k in ("train", "val", "test")}
    if not len(idx["val"]):
        idx["val"] = idx["test"]
    print({k: len(v) for k, v in idx.items()}, "mains ·", len(set(data.subject)), "personnes")

    train = featurize(data.subset(idx["train"]), lab_idx, rng, args.augment)
    val = featurize(data.subset(idx["val"]), lab_idx)
    freq = np.bincount(train[1]["pose"], minlength=len(labels)).astype(np.float32)
    pose_weights = (len(train[0]) / (len(labels) * np.maximum(freq, 1))).astype(np.float32)

    import tensorflow as tf

    tf.random.set_seed(args.seed)
    model = build_model(len(labels))
    model.summary()
    compile_model(model, 1e-3)
    fit(model, train, val, args.epochs, pose_weights, args.batch)
    metrics = {"val": report(model, val, labels, "Validation (personnes jamais vues)")}
    if len(idx["test"]) and not np.array_equal(idx["test"], idx["val"]):
        metrics["test"] = report(model, featurize(data.subset(idx["test"]), lab_idx), labels,
                                 "Test HaGRID (personnes jamais vues)")

    if len(ft):
        tr, va = subject_split(np.array(ft.subject), 0.2, args.seed)
        print("\n=== Affinage sur vos données ===")
        compile_model(model, 2e-4)
        fit(model, featurize(ft.subset(np.where(tr)[0]), lab_idx, rng, args.augment * 4),
            featurize(ft.subset(np.where(va)[0]), lab_idx), max(15, args.epochs // 2), None, 64)
        metrics["finetune"] = report(model, featurize(ft.subset(np.where(va)[0]), lab_idx), labels, "Vos données")

    # Sorties réellement apprises (au moins un exemple étiqueté) : les autres sont ignorées par l'application.
    trained = ["pose"] + [h for h in ("fingers", "palm", "down")
                          if any(v is not None for v in getattr(data, h) + getattr(ft, h))]
    summary = metrics.get("test", metrics["val"])
    export_tfjs(model, labels, args.out, {
        "input": "handFeatures2d (42)", "heads": HEADS, "trained_heads": trained,
        "val_accuracy": metrics["val"]["pose_accuracy"], "test_accuracy": summary["pose_accuracy"],
        "train_hands": int(len(idx["train"])),
    })
    (args.out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

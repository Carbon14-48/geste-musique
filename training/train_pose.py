"""Entraîne le classifieur de poses statiques (modèle A) et l'exporte pour TensorFlow.js.

Entrées possibles (combinables) :
  --npz   fichiers produits par extract_hagrid.py (pré-entraînement sur HaGRID)
  --json  fichiers exportés depuis l'onglet « Données » de l'application (vos propres gestes)

Exemples :
    python train_pose.py --npz data/hagrid_landmarks.npz --json data/mes_poses.json
    python train_pose.py --json data/mes_poses.json --epochs 80          # données maison seules
    python train_pose.py --npz data/hagrid.npz --finetune-json data/mes_poses.json  # pré-entraînement puis affinage

Sortie : public/models/pose/{model.json, *.bin, labels.json} (chargés automatiquement par l'application).
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
    POSE_DIM, WEB_MODELS, augment_world, export_tfjs, legacy_keras, load_browser_dataset, normalize_pose, subject_split,
)


def load_samples(npz_files: list[Path], json_files: list[Path]):
    """Renvoie des listes (world (21,3), handedness, label, subject)."""
    worlds, sides, labels, subjects = [], [], [], []
    for f in npz_files:
        d = np.load(f, allow_pickle=False)
        worlds += list(d["world"])
        sides += list(d["handedness"])
        labels += list(d["label"])
        subjects += [f"{f.stem}:{s}" for s in d["subject"]]
    for f in json_files:
        data = load_browser_dataset(f)
        for p in data["poses"]:
            worlds.append(np.array(p["world"], dtype=np.float64))
            sides.append(p["handedness"])
            labels.append(p["label"])
            subjects.append(f"app:{p.get('subject', 'inconnu')}")
    return worlds, np.array(sides), np.array(labels), np.array(subjects)


def featurize(worlds, sides, rng=None, copies: int = 0):
    """Normalise chaque main ; ajoute `copies` versions augmentées par exemple si rng est fourni."""
    X, idx = [], []
    for i, (w, s) in enumerate(zip(worlds, sides)):
        X.append(normalize_pose(w, s))
        idx.append(i)
        for _ in range(copies):
            X.append(normalize_pose(augment_world(w, rng), s))
            idx.append(i)
    return np.array(X, dtype=np.float32), np.array(idx)


def build_model(n_classes: int, hidden: int = 128):
    keras = legacy_keras()
    model = keras.Sequential([
        keras.layers.Input(shape=(POSE_DIM,)),
        keras.layers.Dense(hidden, activation="relu"),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(hidden // 2, activation="relu"),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(n_classes, activation="softmax"),
    ])
    model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def fit(model, X, y, Xv, yv, epochs, class_weight):
    keras = legacy_keras()
    cb = [
        keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=10, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=4),
    ]
    model.fit(X, y, validation_data=(Xv, yv), epochs=epochs, batch_size=256, class_weight=class_weight, callbacks=cb, verbose=2)


def report(model, Xv, yv, labels: list[str]) -> dict:
    from sklearn.metrics import classification_report, confusion_matrix

    pred = model.predict(Xv, verbose=0).argmax(1)
    present = sorted(set(yv) | set(pred))
    print(classification_report(yv, pred, labels=present, target_names=[labels[i] for i in present], digits=3, zero_division=0))
    cm = confusion_matrix(yv, pred, labels=present)
    print("Matrice de confusion (lignes = vrai, colonnes = prédit) :")
    print("".join(f"{labels[i][:7]:>8}" for i in present))
    for row, i in zip(cm, present):
        print("".join(f"{v:>8}" for v in row), f"  {labels[i]}")
    # Paires les plus confondues (à surveiller : two/peace, palm/open…)
    pairs = []
    for a, i in enumerate(present):
        total = cm[a].sum()
        for b, j in enumerate(present):
            if a != b and total and cm[a, b] / total > 0.03:
                pairs.append((labels[i], labels[j], round(cm[a, b] / total, 3)))
    if pairs:
        print("Confusions > 3 % :", sorted(pairs, key=lambda p: -p[2]))
    return {"accuracy": float((pred == yv).mean()), "confusions": pairs}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--npz", nargs="*", type=Path, default=[])
    ap.add_argument("--json", nargs="*", type=Path, default=[])
    ap.add_argument("--finetune-json", nargs="*", type=Path, default=[], help="affinage final sur vos données")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--augment", type=int, default=3, help="copies augmentées par exemple d'entraînement")
    ap.add_argument("--min-samples", type=int, default=10, help="classes avec moins d'exemples ignorées")
    ap.add_argument("--out", type=Path, default=WEB_MODELS / "pose")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    if not (args.npz or args.json):
        ap.error("donnez au moins --npz ou --json")

    rng = np.random.default_rng(args.seed)
    worlds, sides, labels_raw, subjects = load_samples(args.npz, args.json)
    counts = Counter(labels_raw)
    ft_worlds, ft_sides, ft_labels, ft_subjects = load_samples([], args.finetune_json) if args.finetune_json else ([], [], [], [])
    counts.update(Counter(ft_labels))
    labels = sorted(str(l) for l, c in counts.items() if c >= args.min_samples)
    if len(labels) < 2:
        raise SystemExit(f"Pas assez de classes avec ≥ {args.min_samples} exemples : {dict(counts)}")
    print("Classes (données + affinage) :", {l: counts[l] for l in labels})
    lab_idx = {l: i for i, l in enumerate(labels)}

    keep = np.array([l in lab_idx for l in labels_raw])
    worlds = [w for w, k in zip(worlds, keep) if k]
    sides, labels_raw, subjects = sides[keep], labels_raw[keep], subjects[keep]
    y_all = np.array([lab_idx[l] for l in labels_raw])

    train_mask, val_mask = subject_split(subjects, 0.2, args.seed)
    print(f"Personnes : {len(set(subjects))} — entraînement {train_mask.sum()} exemples, validation {val_mask.sum()}")
    tr = np.where(train_mask)[0]
    va = np.where(val_mask)[0]
    X, idx = featurize([worlds[i] for i in tr], sides[tr], rng, args.augment)
    y = y_all[tr][idx]
    Xv, _ = featurize([worlds[i] for i in va], sides[va])
    yv = y_all[va]

    freq = np.bincount(y, minlength=len(labels)).astype(float)
    class_weight = {i: float(len(y) / (len(labels) * max(f, 1))) for i, f in enumerate(freq)}

    import tensorflow as tf

    tf.random.set_seed(args.seed)
    model = build_model(len(labels))
    fit(model, X, y, Xv, yv, args.epochs, class_weight)
    metrics = report(model, Xv, yv, labels)

    if args.finetune_json:
        keep_ft = np.array([l in lab_idx for l in ft_labels])
        fw = [w for w, k in zip(ft_worlds, keep_ft) if k]
        fs, fl, fsub = np.array(ft_sides)[keep_ft], np.array(ft_labels)[keep_ft], np.array(ft_subjects)[keep_ft]
        fy = np.array([lab_idx[l] for l in fl])
        ftr, fva = subject_split(fsub, 0.2, args.seed)
        Xf, fidx = featurize([fw[i] for i in np.where(ftr)[0]], fs[ftr], rng, args.augment * 2)
        Xfv, _ = featurize([fw[i] for i in np.where(fva)[0]], fs[fva])
        print("\n=== Affinage sur vos données ===")
        model.optimizer.learning_rate.assign(2e-4)
        fit(model, Xf, fy[ftr][fidx], Xfv, fy[fva], max(20, args.epochs // 2), None)
        metrics = report(model, Xfv, fy[fva], labels)

    export_tfjs(model, labels, args.out, {"input": "normalizePose (63)", "val_accuracy": metrics["accuracy"]})
    (args.out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
